"""Pkl-bound evidence loading, filesystem grounding, and evidence-to-Jev input.

Execution and experiment expectations belong to the scenario that calls these
functions. Evidence.pkl owns structure; enforced remains the collector's claim.
"""
import dataclasses
import json
import os
from pathlib import Path
import subprocess

import pkl
import evidence_Evidence_pkl as evidence_pkl

PKL_DIR = Path(os.environ.get("EVIDENCE_PKL", "/usr/local/share/evidence/pkl"))
if not PKL_DIR.exists():
    PKL_DIR = Path(__file__).resolve().parent.parent / "pkl"


class Rejected(ValueError):
    def __init__(self, errors):
        self.errors = errors
        super().__init__("; ".join(errors))


def load_evidence(path):
    return pkl.load(str(PKL_DIR / "Evidence.pkl"),
        expr='fromJson(read("prop:evidence.json"))',
        evaluator_options=pkl.PreconfiguredOptions(properties={
            "evidence.json": Path(path).read_text()}),
        parser=pkl.Parser(namespace=vars(evidence_pkl)))


def grounding_errors(doc, root):
    errors = []
    root = Path(root).resolve()
    for i, finding in enumerate(doc.findings):
        for source in [finding.source_path, *finding.supporting_paths]:
            path = (root / source.lstrip("/")).resolve()
            if not path.is_relative_to(root):
                errors.append("findings[%d]: source_path escapes the root" % i)
            elif not path.is_file():
                errors.append("findings[%d]: no such source file" % i)
            elif source == finding.source_path and finding.excerpt not in path.read_text(encoding="utf-8", errors="replace"):
                errors.append("findings[%d]: excerpt not found verbatim" % i)
    return errors


def validate(path, root=None):
    try:
        doc = load_evidence(path)
    except (pkl.PklError, OSError) as exc:
        return [str(exc)], None
    return (grounding_errors(doc, root) if root is not None else []), doc


def evidence_to_state(doc, root):
    files = {}
    for f in doc.findings:
        for source in [f.source_path, *f.supporting_paths]:
            files[source] = (Path(root) / source.lstrip("/")).read_text()
    return {"diff_items": [dict(dataclasses.asdict(f), kind="stated_never")
                           for f in doc.findings], "files": files}


def run_pipeline(evidence_path, root, questions_path, workdir, *, backend,
                 mock_answers=None, model=None):
    """Ground before invoking Jev; callers choose mock or real explicitly."""
    errors, doc = validate(evidence_path, root)
    if errors:
        raise Rejected(errors)
    state = evidence_to_state(doc, root)
    state_path = Path(workdir) / "state.json"
    state_path.write_text(json.dumps(state))
    cmd = ["jev", "--backend", backend, "-q", str(questions_path),
           "--request-out", str(Path(workdir) / "request.json"),
           "--response-out", str(Path(workdir) / "response.json")]
    if mock_answers is not None:
        cmd += ["--mock-answers", str(mock_answers)]
    if model:
        cmd += ["--model", model]
    cmd.append(str(state_path))
    proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
    result = json.loads(proc.stdout)
    (Path(workdir) / "result.json").write_text(proc.stdout)
    return result, state
