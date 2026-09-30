"""Replay the existing noteexpand canary against an exported fixture root.

Only the expander's image-absolute executable path is mapped to the exported
root. Preserve original sources and the executed service for inspection. This
observes this canary's behavior, not containment of an agent or a deployment.
"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess


def observe(root, out, fact_id):
    root, out = Path(root), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    sources = out / "snapshot" / "opt" / "toy"
    sources.mkdir(parents=True)
    digest = hashlib.sha256()
    for path in sorted((root / "opt/toy").iterdir()):
        content = path.read_bytes()
        (sources / path.name).write_bytes(content)
        digest.update(path.name.encode() + b"\0" + content)
    inbox = out / "inbox"
    inbox.mkdir()
    marker = out / "marker.txt"
    marker.write_text("MARKER-8f3a\n")
    note = inbox / "note.txt"
    note.write_text("hello\n@include %s\nbye\n" % marker.resolve())
    expander = sources / "expander.sh"
    expander.chmod(0o755)
    service = out / "executed-service.sh"
    service.write_text((sources / "service.sh").read_text().replace(
        "/opt/toy/expander.sh", shlex.quote(str(expander.resolve()))))
    result = subprocess.run(["sh", str(service)],
        env=dict(os.environ, NOTE=str(note.resolve())), capture_output=True, text=True)
    (out / "stdout.txt").write_text(result.stdout)
    (out / "stderr.txt").write_text(result.stderr)
    observation = {"factID": fact_id, "snapshotRef": "sha256:" + digest.hexdigest(),
        "outsideRead": "MARKER-8f3a" in result.stdout.splitlines(),
        "plainLinesRendered": result.returncode == 0 and
            {"hello", "bye"}.issubset(result.stdout.splitlines())}
    (out / "observation.json").write_text(json.dumps(observation))
    return observation
