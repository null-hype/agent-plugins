"""Delta thread -> Pkl module, plus Witness findings for what the summary lost.

usage: python3 -I pkl_thread.py THREAD [OUT_DIR]
       python3 -I pkl_thread.py --summarize FILE --full FILE [OUT_DIR]

Runs `delta thread show THREAD` in the summarize and full formats (or reads
the two JSON documents from FILE, as delta prints them, without calling delta) and writes
OUT_DIR/thread.pkl (amending Thread.pkl) and OUT_DIR/.witness/run/findings.json
with one evidence file per finding. Open thread.pkl with the witness language
server running and each loss is a diagnostic on the line where it happened.

A loss is found by looking for each paragraph of the full message in the
summary text, after collapsing whitespace. That is a heuristic: it counts tool
output the same as prose, and a paragraph the summary rewords counts as lost.
"""
import hashlib, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def show(thread, fmt):
    out = subprocess.run(["delta", "thread", "show", thread, "--format", fmt],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)[0]


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def paragraphs(text):
    """(original, normalised) per paragraph of 40+ characters. Matching uses the
    normalised form; evidence keeps the original line breaks."""
    out = [(x.strip("\n"), norm(x)) for x in re.split(r"\n\s*\n", text)]
    return [(r, n) for r, n in out if len(n) >= 40]


_LOGLINE = re.compile(r"^\s*(\$ |\[tool\]|>>> |\d{4}-\d\d-\d\d|[\w./-]+::\S+|[\w./-]+:\d+[: ])"
                      r"|\b(PASSED|FAILED|ERROR|WARN(ING)?|passed|failed)\b")


def looks_like_log(raw):
    """Heuristic only: most lines look like a command, a [tool] line, a timestamp,
    a test id or a pass/fail line. It says nothing about importance."""
    lines = [l for l in raw.split("\n") if l.strip()]
    return bool(lines) and sum(bool(_LOGLINE.search(l)) for l in lines) * 2 >= len(lines)


def quote(raw, n=60):
    t = norm(raw)
    return '"' + (t[:n].rstrip() + "…" if len(t) > n else t) + '"'


def lost_label(raws):
    """`log/tool output: "first 60 chars…" (+N more)` for the lost paragraphs."""
    kind = "log/tool output" if looks_like_log(raws[0]) else "prose"
    return f'{kind}: {quote(raws[0])}' + (f" (+{len(raws) - 1} more)" if len(raws) > 1 else "")


def pkl_str(s, indent):
    """A raw multi-line Pkl string whose every line carries `indent`."""
    d = "#" * next(k for k in range(1, 9) if '"""' + "#" * k not in s)
    return d + '"""\n' + "\n".join(indent + l for l in s.split("\n")) + "\n" + indent + '"""' + d


def analyse(summ, full):
    parts = re.split(r"(?m)^-{8}\n(USER|AGENT)\n-{8}\n", summ["transcript"])
    blocks = [(parts[i], parts[i + 1].rstrip("\n")) for i in range(1, len(parts) - 1, 2)]
    nblocks = [norm(t) for _, t in blocks]
    buf = full["buffer"].encode()
    msgs = []
    for m in full["messages"]:
        text = buf[int(m["start_byte"]):int(m["end_byte"])].decode(errors="replace")
        pairs = paragraphs(text)
        paras = [n for _, n in pairs]
        hit = [next((i for i, b in enumerate(nblocks) if p[:120] in b), None) for p in paras]
        present = [h for h in hit if h is not None]
        msgs.append(dict(
            number=int(m["number"]), role=m["role"], created=m["created_at_utc"], text=text,
            paras=paras, block=min(present) if present else None,
            lost=[r for (r, _), h in zip(pairs, hit) if h is None],
            # Opening kept, whole paragraph not: the summary cut it.
            cut=[(h, r) for (r, p), h in zip(pairs, hit) if h is not None and p not in nblocks[h]]))
    return blocks, msgs


def render(summ, blocks, msgs):
    L = ['amends "Thread.pkl"', ""]
    where = {"block": {}, "omit": {}, "msg": {}}
    L += [f"id = {json.dumps(summ['id'])}", f"name = {json.dumps(summ['name'])}"]
    where["summary"] = len(L) + 1
    L += ("summary = " + (pkl_str(summ["summary"], "  ") if summ.get("summary") else "null")).split("\n")
    L += [f"summaryIsFresh = {str(bool(summ.get('summary_is_fresh'))).lower()}", "", "blocks {"]
    for i, (role, text) in enumerate(blocks):
        where["block"][i] = len(L) + 1
        L += [f"  new {{ // block {i}", f"    role = {json.dumps(role)}"]
        for line in ("    text = " + pkl_str(text, "      ")).split("\n"):
            L.append(line)
            if "omitted ...]" in line:
                where["omit"][i] = len(L)
        L.append("  }")
    L += ["}", "", "messages {"]
    for m in msgs:
        where["msg"][m["number"]] = len(L) + 1
        created = json.dumps(m["created"]) if m["created"] not in (None, "None") else "null"
        block = m["block"] if m["block"] is not None else "null"
        L.append(f'  new {{ number = {m["number"]}; role = "{m["role"]}"; createdAt = {created}; '
                 f'fullBytes = {len(m["text"].encode())}; block = {block} }}')
    L += ["}", ""]
    return "\n".join(L), where


def findings(summ, msgs, where, sha, run):
    out = []

    def add(fid, line, severity, message, evidence=None):
        f = {"id": fid, "location": {"file": "thread.pkl", "line": line, "column": 3},
             "severity": severity, "message": message, "sourceHash": sha}
        if evidence is not None:
            path = f"evidence/{fid}.txt"
            with open(os.path.join(run, path), "w") as fh:
                fh.write(evidence)
            f["evidence"] = [path]
        out.append(f)

    if summ.get("summary") and not summ.get("summary_is_fresh"):
        add("summary-stale", where["summary"], "warning",
            "Delta marks this summary not fresh; it may not cover later messages")
    last = 0
    for m in msgs:
        n, kb = m["number"], len(m["text"].encode()) / 1024
        size = f", {kb:.1f} KB" if kb >= 1 else ""
        who = f'message {n} ({m["role"]}{size})'
        if m["block"] is not None:
            last = m["block"]
        if m["block"] is None and m["paras"]:
            add(f"m{n}-dropped", where["omit"].get(last, where["msg"][n]), "warning",
                f"{who} dropped entirely, {lost_label(m['lost'])}", "\n\n".join(m["lost"]))
        elif m["lost"]:
            add(f"m{n}-partial", where["block"][m["block"]], "information",
                f"{who} dropped {lost_label(m['lost'])}", "\n\n".join(m["lost"]))
        for i, (h, p) in enumerate(m["cut"]):
            at = where["omit"][h] - 2 if h in where["omit"] else where["block"][h]
            add(f"m{n}-cut{i}", at, "error",
                f"{who}: the summary cuts this paragraph mid-sentence: {quote(p)}", p)
    return out


def load(path):
    with open(path) as fh:
        d = json.load(fh)
    return d[0] if isinstance(d, list) else d


def main(thread, out, summarize=None, full=None):
    if summarize:
        summ, full = load(summarize), load(full)
    else:
        summ, full = show(thread, "summarize"), show(thread, "full")
    blocks, msgs = analyse(summ, full)
    src, where = render(summ, blocks, msgs)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "thread.pkl"), "w") as fh:
        fh.write(src)
    shutil.copy(os.path.join(HERE, "Thread.pkl"), out)
    run = os.path.join(out, ".witness", "run")
    shutil.rmtree(run, ignore_errors=True)
    os.makedirs(os.path.join(run, "evidence"))
    sha = "sha256:" + hashlib.sha256(src.encode()).hexdigest()
    fs = findings(summ, msgs, where, sha, run)
    with open(os.path.join(run, "findings.json"), "w") as fh:
        json.dump({"version": 1, "findings": fs}, fh, indent=2)
    print(f"{out}/thread.pkl: {len(blocks)} blocks, {len(msgs)} messages, {len(fs)} findings")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--summarize")
    ap.add_argument("--full")
    ap.add_argument("args", nargs="*")
    a = ap.parse_args()
    if bool(a.summarize) != bool(a.full):
        ap.error("--summarize and --full go together")
    if a.summarize:
        main(None, a.args[0] if a.args else ".", a.summarize, a.full)
    else:
        main(a.args[0], a.args[1] if len(a.args) > 1 else ".")
