"""Rehydrate a named thread snapshot, replay it message by message, verify it.

Replay here is deterministic: recorded messages are re-emitted in order and the
compaction engine is re-run on them. No model is called and no recorded tool
call is re-executed.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = "yoars-deepseek-flash-225035-5484"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def rehydrate(full_bytes, directory):
    """Split the snapshot into one file per message, in a new directory."""
    doc = json.loads(full_bytes)
    thread = doc[0] if isinstance(doc, list) else doc
    buffer = thread["buffer"].encode()
    paths = []
    for index, message in enumerate(thread["messages"]):
        start, end = int(message["start_byte"]), int(message["end_byte"])
        path = os.path.join(directory, f"{index:05d}-{message['role']}.msg")
        with open(path, "wb") as handle:
            handle.write(buffer[start:end])
        paths.append(path)
    return paths


def replay(paths):
    """Read the rehydrated messages back in order and rebuild the transcript."""
    transcript = bytearray()
    for path in paths:
        with open(path, "rb") as handle:
            transcript.extend(handle.read())
    return bytes(transcript)


def tree_hashes(root):
    hashes = {}
    for folder, _, names in os.walk(root):
        for name in names:
            path = os.path.join(folder, name)
            with open(path, "rb") as handle:
                hashes[os.path.relpath(path, root)] = sha256(handle.read())
    return hashes


def run_engine(snapshot_dir, out_dir):
    subprocess.run(
        [sys.executable, "-I", os.path.join(HERE, "engine", "pkl_thread.py"),
         "--summarize", os.path.join(snapshot_dir, "summarize.json"),
         "--full", os.path.join(snapshot_dir, "full.json"), out_dir],
        check=True, capture_output=True, text=True, cwd=snapshot_dir,
    )
    return tree_hashes(out_dir)


def run_replay(snapshot=SNAPSHOT):
    started_at = now()
    snapshot_dir = os.path.join(HERE, "snapshot", snapshot)
    with open(os.path.join(snapshot_dir, "manifest.json"), encoding="utf-8") as handle:
        manifest = json.load(handle)
    with open(os.path.join(snapshot_dir, "full.json"), "rb") as handle:
        full_bytes = handle.read()
    with open(os.path.join(snapshot_dir, "summarize.json"), "rb") as handle:
        summarize_bytes = handle.read()

    checks = {
        "full_json_hash": sha256(full_bytes) == manifest["files"]["full.json"],
        "summarize_json_hash": sha256(summarize_bytes) == manifest["files"]["summarize.json"],
    }
    with tempfile.TemporaryDirectory(prefix="thread-replay-") as work:
        message_dir = os.path.join(work, "messages")
        os.mkdir(message_dir)
        paths = rehydrate(full_bytes, message_dir)
        transcript = replay(paths)
        checks["message_count"] = len(paths) == manifest["message_count"]
        checks["replayed_content_hash"] = sha256(transcript) == manifest["buffer_sha256"]

        outputs = run_engine(snapshot_dir, os.path.join(work, "out"))
        expected = manifest["expected_outputs"]
        mismatched = sorted(k for k in set(outputs) | set(expected) if outputs.get(k) != expected.get(k))
        checks["engine_outputs_match"] = not mismatched

        # Negative control: one changed byte in one message must fail the check.
        with open(paths[len(paths) // 2], "r+b") as handle:
            first = handle.read(1)
            handle.seek(0)
            handle.write(bytes([first[0] ^ 1]))
        checks["tamper_detected"] = sha256(replay(paths)) != manifest["buffer_sha256"]

    return {
        "snapshot": snapshot,
        "snapshot_sha256": manifest["files"]["full.json"],
        "replayed_content_sha256": sha256(transcript),
        "expected_content_sha256": manifest["buffer_sha256"],
        "messages_replayed": len(paths),
        "engine_outputs_checked": len(expected),
        "engine_output_mismatches": mismatched[:10],
        "checks": checks,
        "verdict": "pass" if all(checks.values()) else "fail",
        "replay_started_at": started_at,
        "replay_finished_at": now(),
        "git_commit": os.environ.get("RENDER_GIT_COMMIT"),
        "instance_id": os.environ.get("RENDER_INSTANCE_ID"),
        "service_id": os.environ.get("RENDER_SERVICE_ID"),
    }


if __name__ == "__main__":
    result = run_replay()
    print(json.dumps(result, sort_keys=True))
    sys.exit(0 if result["verdict"] == "pass" else 1)
