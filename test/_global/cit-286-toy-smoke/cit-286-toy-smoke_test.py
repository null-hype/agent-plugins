#!/usr/bin/env python3
"""One recorded composition disagreement, using Pkl-bound records and mock Jev."""
import dataclasses
import json
import os
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, os.environ.get("EVIDENCE_LIB", "/usr/local/share/evidence/lib"))
import pkl
import evidence_contract as ec
from verdict_matcher import new_run, to_have_verdict
from canary import observe

JEV_PKL = Path(os.environ.get("JEV_PKL", "/usr/local/share/jev/pkl"))
if not JEV_PKL.exists():
    JEV_PKL = HERE.parents[2] / "src/jev/pkl"
OPTIONS = pkl.PreconfiguredOptions(modulePaths=[str(ec.PKL_DIR), str(JEV_PKL)])
SCENARIO = pkl.load(str(HERE / "cit-286-toy-smoke.pkl"), evaluator_options=OPTIONS)
RUN = new_run(os.environ.get("CONTRACT_RECORDS_DIR", "/tmp/contract-records"), "noteexpand")


def reconcile(claim_path, observation_path):
    options = pkl.PreconfiguredOptions(modulePaths=[str(ec.PKL_DIR)], properties={
        "claim": Path(claim_path).read_text(), "observation": Path(observation_path).read_text()})
    return pkl.load(str(HERE / "Reconcile.pkl"),
        expr='checkJson(read("prop:claim"), read("prop:observation"))', evaluator_options=options)


class ToyTest(unittest.TestCase):
    def test_claim_observation_and_judgement_are_separate_records(self):
        for arm in ("positive", "control"):
            with self.subTest(arm=arm):
                root = HERE / ("root" if arm == "positive" else "control")
                work = RUN / arm
                observed = observe(root, work, arm)
                # Both observations come from execution, independently of this claim.
                claim = dataclasses.asdict(SCENARIO.claim)
                claim["findings"][0]["enforced"] = arm == "control"
                evidence = work / "evidence.json"
                evidence.write_text(json.dumps(claim))
                questions = work / "questions.json"
                questions.write_text(json.dumps({k: {"type": q.type, "instructions": q.instructions}
                                                for k, q in SCENARIO.questions.items()}))
                answers = work / "mock-answers.json"
                answers.write_text(json.dumps(SCENARIO.mockAnswers))
                result, state = ec.run_pipeline(evidence, work / "snapshot", questions, work,
                                                backend="mock", mock_answers=answers)
                # Jev receives the composed consumer as well as the quoted rule.
                self.assertIn("opt/toy/service.sh", state["files"])
                self.assertIn("opt/toy/expander.sh", state["files"])
                self.assertEqual(set(result["probabilities"]), set(SCENARIO.questions))
                flags = reconcile(evidence, work / "observation.json")
                (work / "diagnostics.json").write_text(json.dumps([dataclasses.asdict(f) for f in flags]))
                to_have_verdict(RUN, arm, "noteexpand.reconcile", str(work),
                                [f.kind for f in flags], SCENARIO.expected[arm])
                self.assertTrue(observed["plainLinesRendered"])
                # Keep the same positive observation; change only the claim.
                if arm == "positive":
                    claim["findings"][0]["enforced"] = True
                    mismatch = work / "mismatched-claim.json"
                    mismatch.write_text(json.dumps(claim))
                    flags = reconcile(mismatch, work / "observation.json")
                    to_have_verdict(RUN, "positive-mismatch", "noteexpand.reconcile", str(work),
                                    [f.kind for f in flags], ["claim-mismatch", "outside-read"])
        print("records:", RUN)


if __name__ == "__main__":
    unittest.main()
