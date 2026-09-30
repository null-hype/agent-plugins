# Code generated from Pkl module `evidence.Evidence`. DO NOT EDIT.
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Set, Union

import pkl


@dataclass
class EvidenceFile:
    findings: List[Finding]

    _registered_identifier = "evidence.Evidence#EvidenceFile"


# One finding: a component states a "never"; `enforced` says whether anything
# in the system enforces it.


@dataclass
class Finding:
    # The component that states the "never".
    component: str

    # Path relative to the image root.
    source_path: str

    # Text that appears verbatim at `source_path`.
    excerpt: str

    # The thing the excerpt says must never happen.
    never: str

    # The agent's claim about enforcement; grounding a quotation does not verify this claim.
    enforced: bool

    # Additional source files supporting the claim; copied into Jev state.
    supporting_paths: List[str]

    _registered_identifier = "evidence.Evidence#Finding"


# The evidence record a reasoning agent emits. This module is the single
# authority for evidence structure: `evidence-validate` evaluates a candidate
# file against these classes (via `Validate.pkl`), and scenario modules use
# the same classes for canned observations. Closed classes, so an unexpected
# key, a missing key, a wrong type or an empty string is a Pkl error.
#
# "No findings" (`findings = new {}`) is valid. Grounding (does the excerpt
# appear verbatim at `source_path` in an image root) needs a filesystem, so it
# is done by the Python adapter, not here.


@dataclass
class Evidence:
    _registered_identifier = "evidence.Evidence"

    @classmethod
    def load_pkl(cls, source):
        # Load the Pkl module at the given source and evaluate it into `evidence_Evidence.Module`.
        # - Parameter source: The source of the Pkl module.
        config = pkl.load(source, parser=pkl.Parser(namespace=globals()))
        return config
