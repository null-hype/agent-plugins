"""On-demand live re-run of the public YOARS thread's assistant turns.

See live-rerun-criterion.json, which is fixed before any run. Each recorded
assistant turn group is regenerated from the recorded messages before it.
Tool calls are not executed; recorded tool results are context only.
"""
import ast
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

from replay import HERE, SNAPSHOT, now, sha256

API = "https://openrouter.ai/api/v1"
ALLOWED_IMPORTS = {"__future__", "typing", "json", "math", "re", "decimal"}
BLOCKED_NAMES = {"open", "exec", "eval", "compile", "__import__", "getattr", "setattr", "delattr",
                 "globals", "locals", "vars", "input", "breakpoint", "dir", "memoryview"}
WRITE_TURN_MESSAGES = (35, 36)
SYSTEM = ("You are re-running a recorded agent session. Continue as the assistant and produce only "
          "the next assistant turn. To call a tool, write a line in the recorded form: "
          "[tool] name {json arguments}. Tools are not executed in this re-run.")
WRITE_HINT = ("Your next action is to write /work/app/transform.py. Emit it as one line: "
              '[tool] write {"path": "/work/app/transform.py", "content": "<full file>"}')

HARNESS = r"""
import contextlib, importlib.util, io, json, sys
spec = importlib.util.spec_from_file_location("candidate", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sink = io.StringIO()
base = {"ident": "EV-1", "person": "mira", "worth": "100", "gauge": "plain", "moment": "1755600000", "variety": "1"}
def rec(**kw):
    r = dict(base); r.update(kw); return r
def call(r):
    try:
        with contextlib.redirect_stdout(sink):
            return True, module.normalize(r)
    except Exception:
        return False, None
def has(out, value=None, group=None):
    if not isinstance(out, dict): return False
    vals = list(out.values())
    ok = True
    if value is not None:
        ok = any(isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v - value) < 1e-9 for v in vals)
    if group is not None:
        ok = ok and group in vals
    return ok
def kept(r, value=None, group=None):
    done, out = call(r); return done and has(out, value, group)
def dropped(r):
    done, out = call(r); return done and out is None
with contextlib.redirect_stdout(sink):
    spec.loader.exec_module(module)
checks = {
    "hundredths": kept(rec(worth="2450", gauge="hundredths", variety="4"), 24.5, "retail"),
    "plain": kept(rec(worth="89.50", gauge="plain", variety="7"), 89.5, "travel"),
    "thousandth": kept(rec(worth="3.75", gauge="thousandth", variety="2"), 3750.0, "food") or kept(rec(worth="3.75", gauge="thousandth-scale", variety="2"), 3750.0, "food"),
    "round_2dp": kept(rec(worth="12.345678"), 12.35),
    "drop_test_person": dropped(rec(person="test-bot")),
    "drop_old_epoch": dropped(rec(moment="1699999999")),
    "keep_epoch_boundary": kept(rec(moment="1700000000"), 100.0),
    "group_1_retail": kept(rec(variety="1"), None, "retail"),
    "group_other": kept(rec(variety="9"), None, "other"),
}
sys.__stdout__.write(json.dumps(checks))
"""


def safety_gate(source):
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return "syntax_error"
    for node in ast.walk(tree):
        if isinstance(node, ast.Import) and any(a.name.split(".")[0] not in ALLOWED_IMPORTS for a in node.names):
            return "blocked_import"
        if isinstance(node, ast.ImportFrom) and (node.level or (node.module or "").split(".")[0] not in ALLOWED_IMPORTS):
            return "blocked_import"
        if isinstance(node, ast.Name) and (node.id in BLOCKED_NAMES or node.id.startswith("__")):
            return "blocked_name"
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            return "blocked_attribute"
    return None


def run_checks(source):
    """Run a candidate in a child with an empty environment, after the gate."""
    blocked = safety_gate(source)
    if blocked:
        return {"gate": blocked, "checks": {}, "passed": False}
    with tempfile.TemporaryDirectory(prefix="live-rerun-") as work:
        candidate = os.path.join(work, "candidate.py")
        with open(candidate, "w", encoding="utf-8") as handle:
            handle.write(source)
        try:
            done = subprocess.run([sys.executable, "-I", "-S", "-c", HARNESS, candidate], env={}, cwd=work,
                                  capture_output=True, text=True, timeout=10)
        except subprocess.TimeoutExpired:
            return {"gate": None, "checks": {}, "passed": False, "error": "timeout"}
    if done.returncode:
        return {"gate": None, "checks": {}, "passed": False, "error": "candidate_crashed"}
    checks = json.loads(done.stdout)
    return {"gate": None, "checks": checks, "passed": bool(checks) and all(checks.values())}


def load_thread(snapshot):
    with open(os.path.join(HERE, "snapshot", snapshot, "full.json"), "rb") as handle:
        doc = json.load(handle)
    thread = doc[0] if isinstance(doc, list) else doc
    buffer = thread["buffer"].encode()
    return [{"number": int(m["number"]), "role": m["role"],
             "text": buffer[int(m["start_byte"]):int(m["end_byte"])].decode("utf-8", "replace")}
            for m in thread["messages"]]


def turn_groups(messages):
    groups = []
    for message in messages:
        if message["role"] != "assistant":
            continue
        if groups and groups[-1][-1]["number"] == message["number"] - 1:
            groups[-1].append(message)
        else:
            groups.append([message])
    return groups


def context_before(messages, number):
    merged = []
    for message in messages:
        if message["number"] >= number:
            break
        if merged and merged[-1]["role"] == message["role"]:
            merged[-1]["content"] += "\n" + message["text"]
        else:
            merged.append({"role": message["role"], "content": message["text"]})
    return merged


def recorded_transform(messages):
    text = next(m["text"] for m in messages if m["number"] == WRITE_TURN_MESSAGES[1])
    return json.loads(text.split("[tool] write ", 1)[1])["content"]


def extract_write(text):
    marker = text.find("[tool] write")
    if marker < 0:
        return None
    start = text.find("{", marker)
    if start < 0:
        return None
    try:
        args, _ = json.JSONDecoder(strict=False).raw_decode(text[start:])
    except ValueError:
        return None
    if str(args.get("path", "")).endswith("transform.py") and isinstance(args.get("content"), str):
        return args["content"]
    return None


def api(path, key, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(API + path, data=data, method="POST" if data else "GET", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json", "X-Title": "thread-replay-live-rerun"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


def key_usage(key):
    try:
        data = api("/key", key)["data"]
        return {"usage_usd": data.get("usage"), "limit_usd": data.get("limit"), "remaining_usd": data.get("limit_remaining")}
    except (urllib.error.URLError, KeyError, ValueError):
        return None


def run_live(snapshot=SNAPSHOT):
    started_at = now()
    with open(os.path.join(HERE, "live-rerun-criterion.json"), "rb") as handle:
        criterion_bytes = handle.read()
    criterion = json.loads(criterion_bytes)
    limits = criterion["limits"]
    messages = load_thread(snapshot)
    groups = turn_groups(messages)
    original = recorded_transform(messages)
    control = run_checks(original)
    broken = run_checks(original.replace("value /= 100.0", "value /= 1.0"))
    controls_valid = control["passed"] and not broken["passed"] and original.count("value /= 100.0") == 1

    result = {"snapshot": snapshot, "model": criterion["model"], "started_at": started_at,
              "criterion_sha256": sha256(criterion_bytes), "recorded_turn_groups": len(groups), "turns": [],
              "official_acceptance_check": "not_run", "controls": {"recorded_passes": control["passed"], "mutant_fails": not broken["passed"]}}
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        result.update(verdict="fail", abort_reason="key_not_set", finished_at=now())
        return result
    result["key_usage_before"] = key_usage(key)
    spent, abort, generated = 0.0, None, None
    for group in groups[:limits["max_turns"]]:
        first, numbers = group[0]["number"], [m["number"] for m in group]
        is_write = tuple(numbers) == WRITE_TURN_MESSAGES
        context = context_before(messages, first)
        if is_write:
            # Attempt 1 put this in the system prompt and the model issued another read.
            context[-1]["content"] += "\n\n[re-run instruction] " + WRITE_HINT + " JSON-escape the file content. Output nothing else."
        body = {"model": criterion["model"], "max_tokens": limits["max_tokens_per_turn"], "temperature": 0.2,
                "usage": {"include": True}, "messages": [{"role": "system", "content": SYSTEM}] + context}
        try:
            reply = api("/chat/completions", key, body)
            choice = reply["choices"][0]
            text = choice["message"].get("content") or ""
            usage = reply.get("usage") or {}
        except urllib.error.HTTPError as error:
            abort = f"http_{error.code}_at_message_{first}"
            break
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError) as error:
            abort = f"{type(error).__name__}_at_message_{first}"
            break
        cost = float(usage.get("cost") or 0)
        spent += cost
        result["turns"].append({"recorded_messages": numbers, "finish_reason": choice.get("finish_reason"), "chars": len(text),
                                "output_sha256": hashlib.sha256(text.encode()).hexdigest(), "prompt_tokens": usage.get("prompt_tokens"),
                                "completion_tokens": usage.get("completion_tokens"), "cost_usd": cost, "generation_id": reply.get("id"),
                                "provider": reply.get("provider"), "preview": text[:160]})
        if is_write:
            generated = extract_write(text)
        if spent >= limits["abort_at_run_cost_usd"]:
            abort = "run_cost_cap_reached"
            break
    evaluation = run_checks(generated) if generated else {"gate": "no_write_emitted", "checks": {}, "passed": False}
    turns = result["turns"]
    criteria = {
        "C1_turns_complete": len(turns) == len(groups) == limits["max_turns"] and all(t["chars"] and t["finish_reason"] == "stop" for t in turns),
        "C2_within_cap": spent < limits["abort_at_run_cost_usd"],
        "C3_controls_valid": controls_valid,
        "C4_generated_transform": evaluation["passed"],
    }
    result.update(run_cost_usd=round(spent, 8), abort_reason=abort, generated_transform_evaluation=evaluation,
                  generated_transform=generated, criteria=criteria, verdict="pass" if all(criteria.values()) and not abort else "fail",
                  key_usage_after=key_usage(key), finished_at=now())
    return result


if __name__ == "__main__":
    messages = load_thread(SNAPSHOT)
    original = recorded_transform(messages)
    print("turn groups", [[m["number"] for m in g] for g in turn_groups(messages)])
    print("recorded", run_checks(original)["passed"], "mutant", run_checks(original.replace("value /= 100.0", "value /= 1.0"))["passed"])
    print("gate blocks os", safety_gate("import os"), "| open", safety_gate("open('x')"), "| dunder", safety_gate("().__class__"))
