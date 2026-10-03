# Code generated from Pkl module `noteexpand.Evidence`. DO NOT EDIT.
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Set, Union

import pkl


@dataclass
class EvidenceFile:
    findings: List[Finding]

    _registered_identifier = "noteexpand.Evidence#EvidenceFile"


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

    _registered_identifier = "noteexpand.Evidence#Finding"


# Evidence used by the noteexpand case. An enforcement value is a claim.


@dataclass
class Evidence:
    _registered_identifier = "noteexpand.Evidence"

    @classmethod
    def load_pkl(cls, source):
        # Load the Pkl module at the given source and evaluate it into `noteexpand_Evidence.Module`.
        # - Parameter source: The source of the Pkl module.
        config = pkl.load(source, parser=pkl.Parser(namespace=globals()))
        return config
