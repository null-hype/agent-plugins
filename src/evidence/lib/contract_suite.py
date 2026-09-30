"""Generic driver for a Pkl-defined method scenario (see pkl/Scenario.pkl).

A scenario's `<scenario>_test.py` is a thin call to `main(...)`. Everything
case-specific lives in the scenario's Pkl module; this file only executes it.

  deterministic    canned observations + mock Jev + seam/guard assertions
  live-jev         canned observations + REAL Jev            (explicit opt-in)
  full-experiment  agent-collected evidence + REAL Jev       (explicit opt-in)

Exit status: 0 = every RUN check passed (a disabled live mode is reported as
NOT RUN and does not change it), 1 = a check failed or an explicitly requested
mode was blocked. Deterministic results and live results are printed under
separate headings and never merged.
"""
import argparse
import http.server
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading

import evidence_contract as ec

_results = {"pass": 0, "fail": 0}


def check(name, cond, detail=""):
    _results["pass" if cond else "fail"] += 1
    print(("  ok   " if cond else "  FAIL ") + name + ((" -- " + str(detail)) if detail and not cond else ""))
    return bool(cond)


def raises(exc, fn):
    try:
        fn()
    except exc:
        return True
    except Exception:
        return False
    return False


class Sentinel:
    """Local HTTP listener standing in for the Jev endpoint: counts any hit."""

    def __init__(self):
        outer = self
        self.hits = 0

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                outer.hits += 1
                self.send_response(500)
                self.end_headers()

            do_GET = do_POST

            def log_message(self, *a):
                pass

        self.srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d/v1/systemone" % self.srv.server_port
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()


SHIM = """#!/bin/bash
# Recording jev shim. One directory per invocation under $JEV_CALLS_DIR holding
# argv and a copy of the state/questions files jev was handed.
d="$JEV_CALLS_DIR/$(ls "$JEV_CALLS_DIR" | wc -l | tr -d ' ')"
mkdir -p "$d"
printf '%s\\n' "$@" > "$d/argv"
prev=""
for a in "$@"; do
  [ "$prev" = "-q" ] && cp "$a" "$d/questions.json"
  prev="$a"
done
cp "${@: -1}" "$d/state.json" 2>/dev/null || true
if [ "${JEV_SHIM_STRICT_MOCK:-}" = "1" ]; then
  case " $* " in
    *" --backend mock "*) ;;
    *) echo "jev shim: refusing a non-mock jev call in deterministic mode" >&2; exit 97;;
  esac
fi
exec "$REAL_JEV" "$@"
"""


class Recorder:
    def __init__(self, tmp, strict):
        self.dir = os.path.join(tmp, "calls")
        os.makedirs(self.dir)
        shimdir = os.path.join(tmp, "shim")
        os.makedirs(shimdir)
        with open(os.path.join(shimdir, "jev"), "w") as fh:
            fh.write(SHIM)
        os.chmod(os.path.join(shimdir, "jev"), 0o755)
        self.env = dict(os.environ, PATH=shimdir + os.pathsep + os.environ["PATH"],
                        JEV_CALLS_DIR=self.dir, REAL_JEV=shutil.which("jev") or "jev")
        if strict:
            self.env["JEV_SHIM_STRICT_MOCK"] = "1"

    def count(self):
        return len(os.listdir(self.dir))

    def call(self, i):
        d = os.path.join(self.dir, str(i))
        out = {"argv": open(os.path.join(d, "argv")).read().split("\n")}
        for n in ("state", "questions"):
            p = os.path.join(d, n + ".json")
            out[n] = json.load(open(p)) if os.path.exists(p) else None
        return out


def load_scenario(module):
    """Agent/Jev-side views only. `expectations` is loaded separately, later."""
    keys = ("groundingFiles", "rootDir", "observations", "ungrounded", "malformed",
            "questions", "mockAnswers", "hintLevel")
    return {k: ec.scenario_view(module, k) for k in keys}


def write_json(path, obj):
    with open(path, "w") as fh:
        json.dump(obj, fh)


def materialize_root(sc, tmp):
    if sc["rootDir"]:
        return sc["rootDir"]
    root = os.path.join(tmp, "root")
    for rel, text in (sc["groundingFiles"] or {}).items():
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as fh:
            fh.write(text)
    os.makedirs(root, exist_ok=True)
    return root


def valid_probs(res, qids):
    p = res.get("probabilities", {})
    return set(p) == set(qids) and all(isinstance(v, (int, float)) and 0.0 <= v <= 1.0 for v in p.values())


def leak_strings(expectations):
    """Strings that exist only in the evaluator-only view."""
    out = set()
    for r in expectations["relative"]:
        out |= {r["higher"], r["lower"]}
    for b in expectations["bands"]:
        out.add(b["observation"])
    return out | {"expectations", "relative", "higher", "lower", "bands"}


def relative_ok(exp, results):
    return all(results[r["higher"]]["probabilities"][r["question"]] >
               results[r["lower"]]["probabilities"][r["question"]] for r in exp["relative"])


# --- deterministic ---------------------------------------------------------

def run_deterministic(module, tmp):
    print("== deterministic (canned evidence + mock Jev; zero real calls) ==")
    plan = ec.plan_mode("deterministic")
    sc = load_scenario(module)
    qids = list(sc["questions"])
    root = materialize_root(sc, tmp)
    qpath = os.path.join(tmp, "questions.json")
    write_json(qpath, sc["questions"])
    rec = Recorder(tmp, strict=True)
    sentinel = Sentinel()
    # Dummy credentials present, endpoint pointed at a counting listener: any
    # real attempt would be visible, and credentials must not change anything.
    rec.env.update(TYPESAFE_API_KEY="dummy", ANTHROPIC_API_KEY="dummy",
                   PROTON_PASS_PERSONAL_ACCESS_TOKEN="dummy", JEV_API_URL=sentinel.url)

    ev = {}
    for group in ("observations", "ungrounded"):
        for oid, doc in sc[group].items():
            ev[oid] = os.path.join(tmp, oid + ".json")
            write_json(ev[oid], doc)
    for oid, text in sc["malformed"].items():
        ev[oid] = os.path.join(tmp, oid + ".json")
        open(ev[oid], "w").write(text)
    ans = {}
    for oid, a in sc["mockAnswers"].items():
        ans[oid] = os.path.join(tmp, "ans-" + oid + ".json")
        write_json(ans[oid], a)

    def cli(*args):
        return subprocess.run(["evidence-validate", *args], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, universal_newlines=True).returncode

    for oid in sc["observations"]:
        check("format+grounding accept %s" % oid, cli("--root", root, ev[oid]) == 0)
    for oid in sc["ungrounded"]:
        check("format ok but ungrounded rejected: %s" % oid,
              cli(ev[oid]) == 0 and cli("--root", root, ev[oid]) == 1)
    for oid in sc["malformed"]:
        check("malformed rejected: %s" % oid, cli(ev[oid]) == 1 and cli("--root", root, ev[oid]) == 1)

    # reject BEFORE jev, observably
    for oid in list(sc["ungrounded"]) + list(sc["malformed"]):
        before = rec.count()
        ok = raises(ec.Rejected, lambda: ec.run_pipeline(
            plan, ev[oid], root, qpath, tmp, "mock", next(iter(ans.values())), env=rec.env))
        check("rejected before Jev, zero invocations: %s" % oid, ok and rec.count() == before)

    # accept path: transform is connected to the evidence that was validated
    results, states = {}, {}
    for oid in sc["observations"]:
        n = rec.count()
        results[oid], states[oid] = ec.run_pipeline(plan, ev[oid], root, qpath, tmp, "mock", ans[oid], env=rec.env)
        c = rec.call(n)
        check("accepted %s: exactly one jev call, explicit --backend mock" % oid,
              rec.count() == n + 1 and "mock" in c["argv"] and "real" not in c["argv"])
        check("accepted %s: one finite probability in [0,1] per question" % oid, valid_probs(results[oid], qids))
        check("captured Jev input for %s equals the transform of its evidence" % oid,
              c["state"] == states[oid] == ec.evidence_to_state(sc["observations"][oid], root))
        check("captured Jev questions for %s are the fixed templates, unchanged" % oid, c["questions"] == sc["questions"])
        for f in sc["observations"][oid]["findings"]:
            check("%s: its own excerpt reaches Jev" % oid, f["excerpt"] in json.dumps(c["state"]))
    oids = list(sc["observations"])
    for i, a in enumerate(oids):
        for b in oids[i + 1:]:
            check("distinct evidence -> distinct Jev input (%s vs %s)" % (a, b), states[a] != states[b])
            for f in sc["observations"][b]["findings"]:
                check("%s's excerpt does not reach the Jev input for %s" % (b, a),
                      f["excerpt"] not in json.dumps(states[a]))

    # evaluator-only material stays out of Jev's request (loaded only now)
    exp = ec.scenario_view(module, "expectations")
    leaks = leak_strings(exp)
    first = ans[oids[0]]
    n = rec.count()
    ec.run_pipeline(plan, ev[oids[0]], root, qpath, tmp, "mock", first, env=rec.env)
    req = subprocess.run(["jev", "--print-request", "-q", qpath, os.path.join(tmp, "state.json")],
                         stdout=subprocess.PIPE, universal_newlines=True).stdout
    check("Jev request excludes expectations, control identities and answers",
          req and not any(s in req for s in leaks), [s for s in leaks if s in req])
    check("Jev request holds exactly state, model and questions", set(json.loads(req)) == {"state", "model", "questions"})

    # expectations over the mock results: wiring only
    check("probability validity holds for every mock result", all(valid_probs(r, qids) for r in results.values()))
    check("relative expectations hold on the mock answers (wiring, not Jev discrimination)", relative_ok(exp, results))

    # zero real calls, and guards
    check("no non-mock jev call was made", all("real" not in rec.call(i)["argv"] for i in range(rec.count())))
    check("real backend refused before any process in deterministic mode",
          raises(ec.RealCallForbidden, lambda: ec.run_jev(plan, "real", os.path.join(tmp, "state.json"), qpath, env=rec.env)))
    for args in (["--backend", "real"], []):
        rc = subprocess.run(["jev", *args, "-q", qpath, os.path.join(tmp, "state.json")], env=rec.env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode
        check("shimmed jev %s is blocked in deterministic mode" % (" ".join(args) or "(default backend)"), rc == 97)
    rc = subprocess.run(["jev", "--backend", "mock", "-q", qpath, os.path.join(tmp, "state.json")], env=rec.env,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode
    check("mock without canned answers fails instead of falling back to real", rc != 0)
    check("dummy credentials produced zero network hits", sentinel.hits == 0, sentinel.hits)
    sentinel.close()

    # credentials never select the mode
    creds = {"TYPESAFE_API_KEY": "dummy", "ANTHROPIC_API_KEY": "dummy", "PROTON_PASS_PERSONAL_ACCESS_TOKEN": "dummy"}
    check("credentials alone do not enable live-jev", not ec.plan_mode("live-jev", creds).runnable)
    check("credentials alone do not enable full-experiment", not ec.plan_mode("full-experiment", creds).runnable)
    check("full-experiment needs BOTH switches",
          not ec.plan_mode("full-experiment", {"CONTRACT_ALLOW_REAL_JEV": "1"}).runnable)
    check("opt-in switches do not turn deterministic into a live mode",
          not ec.plan_mode("deterministic", {"CONTRACT_ALLOW_REAL_JEV": "1"}).allow_real_jev)

    # collection seam (fake runner, no model): runner sees root/hint/out only
    log = os.path.join(tmp, "runner.log")
    runner = os.path.join(tmp, "fake-runner")
    canned = json.dumps(sc["observations"][oids[0]])
    open(runner, "w").write("#!/bin/bash\n{ echo \"ARGV $*\"; env; find . -type f; } > %s\n"
                            "while [ $# -gt 0 ]; do [ \"$1\" = --out ] && out=$2; shift; done\n"
                            "cat > \"$out\" <<'EOF'\n%s\nEOF\n" % (log, canned))
    os.chmod(runner, os.stat(runner).st_mode | stat.S_IXUSR)
    check("agent collection refused in deterministic mode",
          raises(ec.RealCallForbidden, lambda: ec.collect_evidence(plan, runner, root, sc["hintLevel"], os.path.join(tmp, "c.json")))
          and not os.path.exists(log))
    full = ec.plan_mode("full-experiment", {"CONTRACT_ALLOW_REAL_JEV": "1", "CONTRACT_ALLOW_REASONING_AGENT": "1"})
    out = ec.collect_evidence(full, runner, root, sc["hintLevel"], os.path.join(tmp, "c.json"))
    seen = open(log).read()
    check("collected evidence validates and grounds", ec.validate(out, root)[0] == [])
    check("runner got only --root/--hint-level/--out", seen.splitlines()[0].startswith("ARGV --root"))
    check("runner context excludes expectations", not any(s in seen for s in leaks), [s for s in leaks if s in seen])

    # bounds fail closed
    check("repeats above the cap refused", raises(ec.BoundNotEnforceable, lambda: ec.check_bounds(ec.MAX_REPEATS + 1)))
    check("unenforceable token bound refused", raises(ec.BoundNotEnforceable, lambda: ec.check_bounds(1, max_tokens=1000)))
    check("unenforceable spend bound refused", raises(ec.BoundNotEnforceable, lambda: ec.check_bounds(1, max_usd=1)))


# --- live modes ------------------------------------------------------------

def run_live(mode, module, tmp, repeats, model):
    print("== %s (REAL Jev%s) ==" % (mode, " + reasoning agent" if mode == "full-experiment" else ""))
    plan = ec.plan_mode(mode)
    if not plan.runnable:
        print("  NOT RUN: %s" % plan.reason)
        return "not-run"
    ec.check_bounds(repeats, os.environ.get("CONTRACT_MAX_TOKENS"), os.environ.get("CONTRACT_MAX_USD"))
    blockers = []
    if not (os.environ.get("TYPESAFE_API_KEY") or os.environ.get("CONTRACT_PASS_CLI_ENV_FILE")):
        blockers.append("no Jev credential: set TYPESAFE_API_KEY or CONTRACT_PASS_CLI_ENV_FILE")
    runner = os.environ.get("REASONING_AGENT_RUNNER")
    if mode == "full-experiment" and not (runner and shutil.which(runner)):
        blockers.append("REASONING_AGENT_RUNNER is not an executable (the runner lands with CIT-271/CIT-288)")
    if blockers:
        print("  BLOCKED (explicitly requested): " + "; ".join(blockers))
        return "blocked"
    sc = load_scenario(module)
    qids = list(sc["questions"])
    root = materialize_root(sc, tmp)
    qpath = os.path.join(tmp, "questions.json")
    write_json(qpath, sc["questions"])
    rec = Recorder(tmp, strict=False)
    results = {}
    for rep in range(repeats):
        if mode == "live-jev":
            sources = {oid: None for oid in sc["observations"]}
        else:
            sources = {"agent": ec.collect_evidence(plan, runner, root, sc["hintLevel"], os.path.join(tmp, "agent-%d.json" % rep))}
        for oid, path in sources.items():
            if path is None:
                path = os.path.join(tmp, oid + ".json")
                write_json(path, sc["observations"][oid])
            try:
                res, _ = ec.run_pipeline(plan, path, root, qpath, tmp, "real", model=model, env=rec.env)
            except ec.Rejected as e:
                check("repeat %d %s: evidence rejected before Jev" % (rep, oid), False, e.errors)
                continue
            results[oid] = res
            check("repeat %d %s: real Jev returned one probability in [0,1] per question" % (rep, oid),
                  res.get("backend") == "real" and valid_probs(res, qids))
    if mode == "live-jev":
        exp = ec.scenario_view(module, "expectations")
        if exp["relative"] and all(k in results for r in exp["relative"] for k in (r["higher"], r["lower"])):
            print("  relative expectations (pre-registered): %s" % ("hold" if relative_ok(exp, results) else "DO NOT hold"))
            check("pre-registered relative expectations hold on real Jev", relative_ok(exp, results))
    return "ran"


def main(module, argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default=os.environ.get("CONTRACT_MODE", "deterministic"), choices=ec.MODES)
    ap.add_argument("--repeats", type=int, default=int(os.environ.get("CONTRACT_REPEATS", "1")))
    ap.add_argument("--model", default=os.environ.get("CONTRACT_MODEL") or None)
    ap.add_argument("--report-live", action="store_true",
                    help="after the run, print the status of the live modes (not run unless opted in)")
    args = ap.parse_args(argv)
    tmp = tempfile.mkdtemp()
    status = {}
    try:
        if args.mode == "deterministic":
            run_deterministic(module, tmp)
            status["deterministic"] = "pass" if not _results["fail"] else "FAIL"
            if args.report_live:
                for m in ("live-jev", "full-experiment"):
                    plan = ec.plan_mode(m)
                    print("== %s ==\n  %s" % (m, "NOT RUN: " + plan.reason if not plan.runnable else "opted in; select with --mode"))
                    status[m] = "not-run"
        else:
            status[args.mode] = run_live(args.mode, module, tmp, args.repeats, args.model)
    except (ec.BoundNotEnforceable, ec.RealCallForbidden) as e:
        print("  REFUSED: %s" % e)
        status[args.mode] = "refused"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\nsummary: %s | checks: %d passed, %d failed" % (
        ", ".join("%s=%s" % kv for kv in status.items()), _results["pass"], _results["fail"]))
    bad = _results["fail"] or any(v in ("blocked", "refused") for v in status.values())
    return 1 if bad else 0
