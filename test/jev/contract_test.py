#!/usr/bin/env python3
"""Jev request contract: Pkl owns the types, the transport only sees valid ones.

No network and no paid call: the real transport (`jev._http_post`) is replaced
with a recorder, and the API key is set to a dummy so the real-backend code path
is exercised up to (and only up to) the transport.

    python3 test/jev/contract_test.py [path/to/jev]
"""
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile
import unittest

JEV = sys.argv.pop(1) if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), "..", "..", "src", "jev", "jev")

loader = importlib.machinery.SourceFileLoader("jev_bin", JEV)
jev = importlib.util.module_from_spec(importlib.util.spec_from_loader("jev_bin", loader))
loader.exec_module(jev)

STATE = {"diff_items": [{"component": "c", "kind": "modified"}], "n": 1, "f": 2.5, "z": None}
GOOD_Q = {"a02": {"type": "noul", "instructions": "Insecure default?",
                  "criteria": {"true": "yes", "false": "no"}}}


class ContractTest(unittest.TestCase):
    def setUp(self):
        self.sent = []

        def transport(url, key, payload):
            self.sent.append(json.loads(payload))
            return {"model": "jev-latest", "answers": {"a02": {"type": "noul", "noul": 0.5}}}

        jev._http_post = transport
        os.environ["TYPESAFE_API_KEY"] = "dummy"
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def run_jev(self, state, questions):
        paths = []
        for name, doc in (("state", {"meta": {"leak": "X"}, "state": state}), ("q", questions)):
            path = os.path.join(self.tmp.name, name + ".json")
            with open(path, "w") as fh:
                json.dump(doc, fh)
            paths.append(path)
        return jev.main([paths[0], "-q", paths[1]])

    def test_valid_request_is_generated_type_and_reaches_transport_unchanged(self):
        typed = jev.load_request(STATE, GOOD_Q, "jev-latest")
        import jev_pkl  # the module generated from Jev.pkl, put on sys.path by load_request
        self.assertIsInstance(typed, jev_pkl.JevRequest)
        self.assertIsInstance(typed.questions["a02"], jev_pkl.NoulQuestion)
        self.assertIsInstance(typed.questions["a02"].criteria, jev_pkl.Criteria)

        self.assertEqual(self.run_jev(STATE, GOOD_Q), 0)
        self.assertEqual(self.sent, [{"state": STATE, "model": "jev-latest", "questions": GOOD_Q}])

    def test_response_uses_generated_types_and_pkl_constraints(self):
        typed = jev.load_response({"answers": {"a02": {"type": "noul", "noul": 0.5}}}, GOOD_Q, "jev-latest")
        import jev_pkl
        self.assertIsInstance(typed, jev_pkl.JevResponse)
        self.assertIsInstance(typed.answers["a02"], jev_pkl.NoulAnswer)
        for body in ({"answers": {}}, {"answers": {"other": {"noul": 0.5}}},
                     {"answers": {"a02": {"noul": 1.5}}},
                     {"answers": {"a02": {"noul": "0.5"}}},
                     {"answers": {"a02": {"type": "boolean", "noul": 0.5}}}):
            with self.subTest(body=body), self.assertRaises(SystemExit):
                jev.load_response(body, GOOD_Q, "jev-latest")

    def test_invalid_requests_fail_pkl_evaluation_before_transport(self):
        bad = {
            "wrong type": {"q": {"type": "boolean", "instructions": "x"}},
            "empty instructions": {"q": {"type": "noul", "instructions": ""}},
            "missing instructions": {"q": {"type": "noul"}},
            "unknown field": {"q": {"type": "noul", "instructions": "x", "expected": 1}},
            "criteria not an object": {"q": {"type": "noul", "instructions": "x", "criteria": []}},
            "no questions": {},
        }
        for label, questions in bad.items():
            with self.subTest(label), self.assertRaises(SystemExit) as ctx:
                self.run_jev(STATE, questions)
            self.assertEqual(ctx.exception.code, 2)
        self.assertEqual(self.sent, [], "transport must not be invoked for an invalid request")


if __name__ == "__main__":
    unittest.main()
