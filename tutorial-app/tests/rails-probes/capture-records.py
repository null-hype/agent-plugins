#!/usr/bin/env python3
"""Validate retained inputs and export one Question across two revisions.

This adapts existing captures; it does not claim a new container execution.
Usage: python3 capture-records.py /tmp/cit334-records
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

APP = Path(__file__).resolve().parents[2]
HISTORY = APP / 'evidence/cit-294-review-history-v1'
REPRO = APP / 'evidence/cit-294-probe-reproduction-v1'
TRACES = Path(__file__).resolve().parent / 'traces'
MANIFEST = json.loads((HISTORY / 'manifest.json').read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def retained(path, origin):
    data = path.read_bytes()
    return dict(uri=str(path.relative_to(APP)), origin=origin,
                availability='retained', immutableId='sha256:' + digest(data), reason=None)


def missing(uri, origin, reason):
    return dict(uri=uri, origin=origin, availability='missing', immutableId=None, reason=reason)


def capture(state, out):
    revision = MANIFEST['revisions'][state]
    sha = revision['pinned']
    inputs = []
    for entry in MANIFEST['files']:
        if entry['revision'] != sha or not entry['path'].startswith('docs/investigations/CIT-265/cit-294/'):
            continue
        path = HISTORY / entry['file']
        data = path.read_bytes()
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if digest(data) != entry['sha256'] or blob != entry['blobId']:
            raise ValueError('Pinned input mismatch: ' + str(path))
        inputs.append(retained(path, 'historical'))
    # Verify supplemental files against immutable blobs at the merged equivalent.
    for path in sorted((REPRO / 'inputs' / state).iterdir()):
        expected = subprocess.check_output([
            'git', 'rev-parse', revision['merged']['sha'] + ':docs/investigations/CIT-265/cit-294/' + path.name
        ], cwd=APP).decode().strip()
        data = path.read_bytes()
        actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if actual != expected:
            raise ValueError('Supplement mismatch: ' + str(path))
        inputs.append(retained(path, 'historical'))
    if not inputs:
        raise ValueError('No pinned inputs for ' + state)
    probe = REPRO / 'reproduction' / state / 'probes/deleted-trace'
    observations = [retained(probe / name, 'reproduced') for name in ('answer.json', 'result.txt', 'mutation.txt')]
    observations.append(missing(state + '/original-mutation-output', 'historical',
                                'Original reviewer mutation output was not retained.'))
    source = dict(uri=MANIFEST['repository'], origin='historical', availability='retained',
                  immutableId='git-commit:' + sha, reason=None)
    before = dict(id=state + '-pinned', source=source, scope=['Pinned checker modules and retained arm evidence'],
                  inputs=inputs, image=missing(state + '/image', 'historical', 'No image digest in this capture.'),
                  snapshot=missing(state + '/snapshot', 'historical', 'No container snapshot in this capture.'),
                  limitations=['Only checker inputs; application and runtime state are not captured.'])
    after = dict(before, id=state + '-deleted-trace', inputs=[e for e in inputs if not e['uri'].endswith('/canary-reads.txt')])
    review = 'review-1.finding-1' if state == 'S1' else 'review-2.gap-1'
    declaration = retained(HISTORY / 'captures' / ('github-pr-117-body.md' if state == 'S1' else 'github-pr-118-body.md'), 'historical')
    raw = dict(id=state + '-deleted-trace', questionId='deleted-trace',
               before=before, after=after,
               transition=dict(**{'from': before['id'], 'to': after['id']}, action='Remove the retained trace before evaluating the checker', evidence=[observations[2]]),
               delivery=dict(feature='cve-2026-66066', version='20261008.0811', status='planned', finding=review,
                             scenario='test/_global/cve-2026-66066-forensics', evidence=None),
               declarations=[dict(text=(APP / declaration['uri']).read_text(), evidence=declaration)],
               forecast=None, answer=json.loads((probe / 'answer.json').read_text()), observations=observations)
    target = out / (state + '-capture.json')
    target.write_text(json.dumps(raw, indent=2) + '\n')
    result = subprocess.check_output(['pkl', 'eval', str(TRACES / 'ReplayRecord.pkl'),
        '-p', 'capture=' + str(target), '-p', 'state=' + state, '-p', 'checker=' + sha,
        '-p', 'reproductionId=cit-294-checker-probes-reproduction-v1', '-p', 'run=' + str(REPRO / 'reproduction' / state)], cwd=APP)
    (out / (state + '-record.json')).write_bytes(result)


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for state in ('S1', 'S2'):
        capture(state, out)
    print('Validated S1 and S2 records in ' + str(out))
