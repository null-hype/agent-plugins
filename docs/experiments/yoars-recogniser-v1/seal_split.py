#!/usr/bin/env python3
import hashlib, json, math, pathlib, sys

SALT = b"yoars-recogniser-v1\0"

def rank(run_id):
    return hashlib.sha256(SALT + run_id.encode()).digest()[:8]

def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: seal_split.py INPUT.json OUTPUT.json")
    source = pathlib.Path(sys.argv[1]).read_bytes()
    rows = json.loads(source)
    if not isinstance(rows, list) or not rows:
        raise SystemExit("input must be a non-empty JSON array")
    required = {"run_id", "condition", "restic_snapshot"}
    if any(not isinstance(r, dict) or not required <= r.keys() or
           any(not isinstance(r[k], str) or not r[k] for k in required) for r in rows):
        raise SystemExit("every row needs non-empty string run_id, condition, restic_snapshot")
    ids = [r["run_id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate run_id")
    by_condition = {}
    for row in rows:
        by_condition.setdefault(row["condition"], []).append(row)
    assignments = []
    for condition, group in sorted(by_condition.items()):
        ordered = sorted(group, key=lambda r: (rank(r["run_id"]), r["run_id"]))
        n_dev = math.floor(len(ordered) * .7 + .5)
        for i, row in enumerate(ordered):
            assignments.append({**{k: row[k] for k in sorted(row)},
                                "split": "development" if i < n_dev else "held_out"})
    payload = {"protocol_version": "1.0.0", "algorithm": "sha256-stratified-70-30-v1",
               "source_sha256": hashlib.sha256(source).hexdigest(),
               "assignments": sorted(assignments, key=lambda r: r["run_id"])}
    pathlib.Path(sys.argv[2]).write_text(json.dumps(payload, indent=2) + "\n")

if __name__ == "__main__": main()

