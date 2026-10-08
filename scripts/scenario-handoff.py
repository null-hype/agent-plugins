#!/usr/bin/env python3
"""Package exported scenario evidence for an explicitly identified CI artifact."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tarfile
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--state', required=True)
args = p.parse_args()
args.output.mkdir(parents=True)
archive = args.output / 'evidence.tar'
def scope(member):
    if member.name.startswith('verification/retained'): return None
    return member
with tarfile.open(archive, 'w') as tar:
    for name in ['capture', 'verification']:
        if (args.root / name).exists(): tar.add(args.root / name, arcname=name, filter=scope)
file = args.root / 'capture/retention.json'
manifest = json.loads(file.read_text()) if file.exists() else {}
with archive.open('rb') as stream: digest = 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest()
handoff = dict(format='scenario-handoff-v1', historicalState=args.state, sourceCommit=os.environ['CAPTURE_SOURCE_SHA'],
    executionCommit=manifest.get('source', {}).get('commit'), snapshotId=manifest.get('snapshotId'), image=manifest.get('image'),
    completeCapture=bool(manifest), archiveSha256=digest, artifactName=os.environ['CAPTURE_ARTIFACT_NAME'],
    repository=os.environ['GITHUB_REPOSITORY'], runId=int(os.environ['GITHUB_RUN_ID']), runAttempt=int(os.environ['GITHUB_RUN_ATTEMPT']), configuredRetentionDays=90)
(args.output / 'handoff.json').write_text(json.dumps(handoff, indent=2) + '\n')
with open(os.environ['GITHUB_OUTPUT'], 'a') as stream: stream.write('artifact-name=' + handoff['artifactName'] + '\n')
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
    stream.write(f"Retained {args.state} snapshot `{handoff['snapshotId']}`; published as `{handoff['artifactName']}`. Capture and logs copied before container disposal. Requested retention: 90 days; use artifact API expiry.\n")
