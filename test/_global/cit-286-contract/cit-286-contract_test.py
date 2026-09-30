#!/usr/bin/env python3
"""Direct evidence -> Jev seam checks. The only backend invoked is mock."""
import dataclasses
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, os.environ.get("EVIDENCE_LIB", "/usr/local/share/evidence/lib"))
import pkl
import evidence_contract as ec
from verdict_matcher import new_run, to_have_verdict

JEV_PKL = Path(os.environ.get("JEV_PKL", "/usr/local/share/jev/pkl"))
if not JEV_PKL.exists():
    JEV_PKL = REPO / "src/jev/pkl"
FIXTURE = pkl.load(str(HERE / "cit-286-contract.pkl"),
    evaluator_options=pkl.PreconfiguredOptions(modulePaths=[str(ec.PKL_DIR), str(JEV_PKL)]))
RUN = new_run(os.environ.get("CONTRACT_RECORDS_DIR", "/tmp/contract-records"), "contract")


class ContractTest(unittest.TestCase):
    def test_grounded_input_reaches_mock_unchanged(self):
        root = RUN / "root"
        for path, content in FIXTURE.files.items():
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        evidence = RUN / "evidence.json"
        evidence.write_text(json.dumps(dataclasses.asdict(FIXTURE.evidence)))
        questions = RUN / "questions.json"
        questions.write_text(json.dumps({k: {"type": q.type, "instructions": q.instructions}
                                         for k, q in FIXTURE.questions.items()}))
        answers = RUN / "mock-answers.json"
        answers.write_text(json.dumps(FIXTURE.response))
        calls = []
        invoke = subprocess.run
        def record(cmd, **kwargs):
            if cmd[0] == "jev":
                calls.append(cmd)
            return invoke(cmd, **kwargs)
        with patch.object(ec.subprocess, "run", record):
            result, state = ec.run_pipeline(evidence, root, questions, RUN,
                                            backend="mock", mock_answers=answers)
        to_have_verdict(RUN, "grounded", "evidence.toJev", str(RUN),
                        result["probabilities"], FIXTURE.response)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1:3], ["--backend", "mock"])
        request = json.loads(invoke(["jev", "--print-request", "-q", str(questions),
                                    str(RUN / "state.json")], check=True, capture_output=True, text=True).stdout)
        (RUN / "request.json").write_text(json.dumps(request))
        self.assertEqual(request["state"], state)
        self.assertEqual(request["questions"], json.loads(questions.read_text()))
        self.assertEqual(set(request), {"state", "questions", "model"})
        self.assertIn(FIXTURE.evidence.findings[0].excerpt, state["files"]["app/README.md"])
        # Distinct evidence must produce distinct state; no-findings is valid.
        none = RUN / "none.json"
        none.write_text('{"findings":[]}')
        _, doc = ec.validate(none, root)
        self.assertNotEqual(ec.evidence_to_state(doc, root), state)
        for index, value in enumerate(('not json', evidence.read_text().replace('Never pass', 'Always pass'))):
            bad = RUN / ('rejected-%d.json' % index)
            bad.write_text(value)
            calls.clear()
            with patch.object(ec.subprocess, "run", record):
                with self.assertRaises(ec.Rejected):
                    ec.run_pipeline(bad, root, questions, RUN, backend="mock", mock_answers=answers)
                to_have_verdict(RUN, "rejected", "evidence.beforeJev", str(bad), len(calls), 0)
        print("records:", RUN)


if __name__ == "__main__":
    unittest.main()
