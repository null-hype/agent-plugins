# Code generated from Pkl module `noteexpand.reconcile`. DO NOT EDIT.
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Set, Union

import pkl


@dataclass
class Flag:
    kind: str

    factID: str

    detail: str

    _registered_identifier = "noteexpand.reconcile#Flag"


@dataclass
class Observation:
    factID: str

    snapshotRef: str

    outsideRead: bool

    plainLinesRendered: bool

    _registered_identifier = "noteexpand.reconcile#Observation"


# noteexpand canary reconciliation. Scoped to the observed outside-file read;
# it does not establish every interpretation of the README's author rule.


@dataclass
class reconcile:
    _registered_identifier = "noteexpand.reconcile"

    @classmethod
    def load_pkl(cls, source):
        # Load the Pkl module at the given source and evaluate it into `noteexpand_reconcile.Module`.
        # - Parameter source: The source of the Pkl module.
        config = pkl.load(source, parser=pkl.Parser(namespace=globals()))
        return config
