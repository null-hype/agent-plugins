# Code generated from Pkl module `jev`. DO NOT EDIT.
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Set, Union

import pkl


JsonValue = Union[str, bool, float, Dict[Any, Any], List[Any], None]


# Optional free-text descriptions of what a yes/no answer means. Both fields
# optional per the API.


@dataclass
class Criteria:
    true: Optional[str]

    false: Optional[str]

    _registered_identifier = "jev#Criteria"


# The request body. Only `state`, `model`, and `questions` -- a closed class,
# so amending it with harness-only `meta`/`expected` is a structural error,
# which is exactly the "only `state` is sent" rule expressed as a type.


@dataclass
class JevRequest:
    state: JsonValue

    model: str

    questions: Dict[str, NoulQuestion]

    _registered_identifier = "jev#JevRequest"


# One Noul question. `type` is always "noul"; `instructions` carries the whole
# judgement (OWASP category semantics live in this text, not in any dedicated
# field). `criteria` is optional.


@dataclass
class NoulQuestion:
    type: Literal["noul"]

    instructions: str

    criteria: Optional[Criteria]

    _registered_identifier = "jev#NoulQuestion"


# The Jev/Noul transport contract: the shape of one request the `jev` client
# sends to TypeSafe's Jev judge and the response it accepts back.
#
# This is the single owner of the contract. The `jev` bin loads a request
# through this module with the pkl-python binding (`requestFromJson` below),
# and reads the result as the dataclasses generated from this same file
# (`jev_pkl.py`, via `pkl-gen-python`), so a structurally invalid request
# fails Pkl evaluation before any transport is invoked -- Python carries no
# second copy of these rules. See NOTES.md for regeneration.
#
# Verified against docs.typesafe.ai/api (POST https://api.typesafe.ai/v1/systemone).


@dataclass
class jev:
    _registered_identifier = "jev"

    @classmethod
    def load_pkl(cls, source):
        # Load the Pkl module at the given source and evaluate it into `jev.Module`.
        # - Parameter source: The source of the Pkl module.
        config = pkl.load(source, parser=pkl.Parser(namespace=globals()))
        return config
