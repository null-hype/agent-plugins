"""Compare and record, as tutorial-app/toHaveVerdict does. No check semantics."""
import json
from pathlib import Path
from uuid import uuid4


def new_run(records_dir, name):
    path = Path(records_dir) / (name + "-" + uuid4().hex)
    path.mkdir(parents=True)
    return path


def to_have_verdict(run_dir, fact_id, axiom, world_ref, actual, expected):
    passed = actual == expected
    with (Path(run_dir) / "evaluations.jsonl").open("a") as fh:
        fh.write(json.dumps({"factId": fact_id, "axiomId": axiom,
            "worldRef": world_ref, "actual": actual, "expected": expected,
            "status": "pass" if passed else "fail"}) + "\n")
    if not passed:
        raise AssertionError("%s for %s: %r, expected %r" %
                             (axiom, fact_id, actual, expected))
