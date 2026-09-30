#!/usr/bin/env python3
"""CIT-286 toy-case scenario driver. Defined in Pkl (cit-286-toy-smoke.pkl).
Default mode is deterministic (canned evidence, mock Jev); the live modes run
only when explicitly selected AND opted in (see src/evidence/README.md)."""
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
for p in (os.environ.get("EVIDENCE_LIB"), "/usr/local/share/evidence/lib"):
    if p and os.path.isdir(p):
        sys.path.insert(0, p)
        break

import contract_suite  # noqa: E402

sys.exit(contract_suite.main(os.path.join(here, "cit-286-toy-smoke.pkl")))
