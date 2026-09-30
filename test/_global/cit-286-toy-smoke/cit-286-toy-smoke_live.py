#!/usr/bin/env python3
"""Explicit live entry point. Never imported or invoked by the CI tests.

Supply an evidence file, or an executable collector. Caller configures the
collector's isolation and records its trace; this script makes no containment
claim. Each repeat retains evidence, manifest (when collected), observed canary,
request, raw response, result and diagnostics. No confidence cutoff is supplied.
"""
import argparse
import dataclasses
import json
import os
from pathlib import Path
import subprocess
import sys
import pkl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, os.environ.get("EVIDENCE_LIB", "/usr/local/share/evidence/lib"))
import evidence_contract as ec
from verdict_matcher import new_run, to_have_verdict
from canary import observe


def main():
    ap = argparse.ArgumentParser()
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument("--evidence", type=Path)
    source.add_argument("--runner", help="executable collector (caller supplies its isolation)")
    ap.add_argument("--root", type=Path, default=HERE / "root")
    ap.add_argument("--hint-level", type=int, default=1)
    ap.add_argument("--model")
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--records-dir", default=os.environ.get("CONTRACT_RECORDS_DIR", "/tmp/contract-records"))
    args = ap.parse_args()
    if args.repeats < 1:
        ap.error("repeats must be positive")
    jev_pkl = Path(os.environ.get("JEV_PKL", "/usr/local/share/jev/pkl"))
    if not jev_pkl.exists():
        jev_pkl = HERE.parents[2] / "src/jev/pkl"
    scenario = pkl.load(str(HERE / "cit-286-toy-smoke.pkl"),
        evaluator_options=pkl.PreconfiguredOptions(modulePaths=[str(ec.PKL_DIR), str(jev_pkl)]))
    run = new_run(args.records_dir, "noteexpand-live")
    print("records:", run, flush=True)
    for repeat in range(args.repeats):
        work = run / ("repeat-%d" % repeat)
        work.mkdir()
        evidence = work / "evidence.json"
        if args.runner:
            subprocess.run([args.runner, "--root", str(args.root.resolve()),
                "--hint-level", str(args.hint_level), "--out", str(evidence.resolve()),
                "--isolation-manifest", str((work / "runner-init.json").resolve())], check=True)
        else:
            evidence.write_bytes(args.evidence.read_bytes())
        # Inspect the original collected input even if validation rejects it.
        questions = work / "questions.json"
        questions.write_text(json.dumps({k: {"type": q.type, "instructions": q.instructions}
                                        for k, q in scenario.questions.items()}))
        observed = observe(args.root, work / "canary", "positive")
        result, state = ec.run_pipeline(evidence, work / "canary/snapshot", questions, work,
                                        backend="real", model=args.model)
        flags = pkl.load(str(HERE / "Reconcile.pkl"),
            expr='checkJson(read("prop:claim"), read("prop:observation"))',
            evaluator_options=pkl.PreconfiguredOptions(modulePaths=[str(ec.PKL_DIR)],
                properties={"claim": evidence.read_text(), "observation": json.dumps(observed)}))
        (work / "diagnostics.json").write_text(json.dumps([dataclasses.asdict(f) for f in flags]))
        to_have_verdict(run, "positive", "noteexpand.reconcile", str(work),
                        [f.kind for f in flags], scenario.expected["positive"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
