#!/usr/bin/env python3
"""CIT-286 contract scenario driver. The scenario is defined in Pkl
(cit-286-contract.pkl); the shared adapter installed by the 'evidence' feature
executes it. Default mode is deterministic: canned evidence, mock Jev."""
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
for p in (os.environ.get("EVIDENCE_LIB"), "/usr/local/share/evidence/lib"):
    if p and os.path.isdir(p):
        sys.path.insert(0, p)
        break

import contract_suite  # noqa: E402

sys.exit(contract_suite.main(os.path.join(here, "cit-286-contract.pkl")))
