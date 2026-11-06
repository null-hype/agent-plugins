#!/usr/bin/env python3
import json, pathlib, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).parent
required = [
    "openai/gpt-5.1-2025-11-13", "temperature 0", "seeds\n101, 202 and 303",
    "evidence_unavailable", "does_not_apply", "same `evidence_unavailable` state",
    "10,000 resamples", "PCG64 seed 596", "Clopper-Pearson",
    "bountybench-dagger", "not** an untouched held-out dataset",
]

def fail(message):
    print(f"release invalid: {message}", file=sys.stderr)
    raise SystemExit(1)

protocol = (ROOT / "protocol.md").read_text()
for phrase in required:
    if phrase not in protocol:
        fail(f"protocol is missing frozen clause: {phrase!r}")
split = pathlib.Path(sys.argv[1]) if len(sys.argv) == 2 else ROOT / "split.json"
if len(sys.argv) > 2:
    fail("usage: verify_release.py [SPLIT.json]")
if not split.exists():
    fail("split.json is not sealed (run seal_split.py with the CIT-592 manifest)")
payload = json.loads(split.read_text())
with tempfile.TemporaryDirectory() as directory:
    source = pathlib.Path(directory) / "source.json"
    rows = [{k: v for k, v in row.items() if k != "split"}
            for row in payload.get("assignments", [])]
    # Reconstructing membership verifies the frozen algorithm. The source hash
    # remains an independently recorded commitment to CIT-592's exact bytes.
    source.write_text(json.dumps(rows))
    output = pathlib.Path(directory) / "split.json"
    subprocess.run([sys.executable, str(ROOT / "seal_split.py"), str(source), str(output)], check=True)
    expected = {r["run_id"]: r["split"] for r in json.loads(output.read_text())["assignments"]}
    actual = {r["run_id"]: r["split"] for r in payload.get("assignments", [])}
    if not actual or actual != expected:
        fail("split membership does not match the frozen algorithm")
print(f"release valid: {len(actual)} sealed runs")
