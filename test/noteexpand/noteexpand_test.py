#!/usr/bin/env python3
"""Observe the installed case, then check its evidence against Pkl goldens."""
import argparse
import dataclasses
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pkl

HERE = Path(__file__).resolve().parent
CASE_HOME = Path("/usr/local/share/noteexpand")
sys.path.insert(0, str(CASE_HOME / "lib"))
import noteexpand_Evidence_pkl as evidence_pkl

args = argparse.ArgumentParser()
args.add_argument("--control", action="store_true")
args.add_argument("--jev", action="store_true")
options = args.parse_args()
arm = "control" if options.control else "positive"
run = HERE / "noteexpand-records" / (arm + "-" + uuid4().hex)
snapshot = run / "snapshot" / "opt/toy"
snapshot.mkdir(parents=True)
digest = hashlib.sha256()
for source in sorted(Path("/opt/toy").iterdir()):
    data = source.read_bytes()
    (snapshot / source.name).write_bytes(data)
    digest.update(source.name.encode() + b"\0" + data)

# The marker is outside the caller's note directory. Execute the installed bytes.
(run / "inbox").mkdir()
marker = run / "marker.txt"
marker.write_text("MARKER-8f3a\n")
note = run / "inbox/note.txt"
note.write_text("hello\n@include %s\nbye\n" % marker)
proc = subprocess.run(["/opt/toy/service.sh"], env=dict(os.environ, NOTE=str(note)),
                      capture_output=True, text=True)
(run / "stdout.txt").write_text(proc.stdout)
(run / "stderr.txt").write_text(proc.stderr)
observation = {"factID": arm, "snapshotRef": "sha256:" + digest.hexdigest(),
               "outsideRead": "MARKER-8f3a" in proc.stdout.splitlines(),
               "plainLinesRendered": proc.returncode == 0 and
                   {"hello", "bye"}.issubset(proc.stdout.splitlines())}
(run / "observation.json").write_text(json.dumps(observation))

claim = pkl.load(str(HERE / "Claims.pkl"), expr=arm,
                 evaluator_options=pkl.PreconfiguredOptions(modulePaths=[str(CASE_HOME / "pkl")]),
                 parser=pkl.Parser(namespace=vars(evidence_pkl)))
assert isinstance(claim, evidence_pkl.EvidenceFile)
evidence = dataclasses.asdict(claim)
(run / "evidence.json").write_text(json.dumps(evidence))
subprocess.run(["pkl", "test", "--module-path", str(CASE_HOME / "pkl"),
                "-p", "claim=" + json.dumps(evidence),
                "-p", "observation=" + json.dumps(observation),
                "-p", "snapshotRoot=" + str(run / "snapshot"),
                "--junit-reports", str(run), str(HERE / (arm + ".test.pkl"))], check=True)

if options.jev:
    state = {"diff_items": [dict(f, kind="stated_never") for f in evidence["findings"]],
             "files": {"opt/toy/" + p.name: p.read_text() for p in snapshot.iterdir()}}
    (run / "state.json").write_text(json.dumps(state))
    (run / "questions.json").write_text(json.dumps({"unenforced_never": {
        "type": "noul", "instructions": "Does the supplied composition permit the stated prohibited operation?"}}))
    answers = {"unenforced_never": 0.8}
    (run / "mock-answers.json").write_text(json.dumps(answers))
    with (run / "result.json").open("w") as result:
        subprocess.run(["jev", "--backend", "mock", "--mock-answers", str(run / "mock-answers.json"),
                        "-q", str(run / "questions.json"), "--request-out", str(run / "request.json"),
                        "--response-out", str(run / "response.json"), str(run / "state.json")],
                       stdout=result, check=True)
    assert json.loads((run / "request.json").read_text())["state"] == state
    assert json.loads((run / "result.json").read_text())["probabilities"] == answers

print("records:", run)
