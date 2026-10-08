#!/usr/bin/env python3
"""Account for CIT-339's replaced representations, separately from retained evidence.

The pre-CIT-339 before-state once lived on the CIT-339 PR branch (commit
dea80d7c) and was read live with `git ls-tree`/`git show`. That commit was
discarded by the squash-merge (#165), so it is unreachable on main and on any
sibling PR checkout and the derivation fails with "fatal: not a tree object".
The before-state describes immutable history, so it is pinned in
`vaults-replay/baseline.json`; the after-state and the retained-evidence
integrity check are still recomputed from the working tree and the capsule.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SCOPE = '.dagger/internal/devenv-base/pkl/vaults-replay'
spec = importlib.util.spec_from_file_location('bundle', ROOT / 'scripts/investigation-bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def stats(entries):
    unique = {e['sha256']: e['bytes'] for e in entries}
    size = sum(e['bytes'] for e in entries)
    return dict(files=len(entries), uncompressedBytes=size, uniqueContents=len(unique),
                uniqueContentBytes=sum(unique.values()), duplicateFiles=len(entries) - len(unique),
                duplicateContentBytes=size - sum(unique.values()))


def report():
    baseline = json.loads((ROOT / SCOPE / 'baseline.json').read_text())
    scope = ROOT / SCOPE
    with tempfile.TemporaryDirectory(prefix='vaults-accounting-') as temporary:
        restored = Path(temporary) / 'scope'
        descriptor = bundle.unpack(scope / 'evidence.tar.gz', restored)
        manifest = json.loads((restored / 'inputs.json').read_text())
        legacy = json.loads((restored / 'legacy.json').read_text())
        # Every historical path's bytes remain accessible from the retained
        # capsule, including retired generated presentation. This is the live
        # integrity check that survives squash-merge. legacy.json and the
        # capsule descriptor are mutable and travel with the capsule, so they
        # cannot anchor themselves; baseline.json's retainedDigests is the
        # independent, committed expectation (it replaces the pre-CIT-339 git
        # hashes the squashed BASE used to supply). Both the path set and each
        # blob digest are checked against it, so a regenerated capsule that
        # drops, swaps or re-hashes a historical path is caught even if the
        # path count is preserved.
        expected = baseline['retainedDigests']
        refs = legacy['paths']
        present = {name: retained for name, retained in refs.items()
                   if name.startswith(('inputs/', 'captured/'))}
        if set(present) != set(expected):
            missing = sorted(set(expected) - set(present))
            added = sorted(set(present) - set(expected))
            raise RuntimeError('retained original evidence path set changed; missing=%s added=%s'
                               % (missing, added))
        for name, want in expected.items():
            if bundle.retention.digest(restored / present[name]['uri']) != want:
                raise RuntimeError('original evidence bytes changed: ' + name)
        verified = len(expected)
        if verified != baseline['originalEvidenceVerified']:
            raise RuntimeError('retained original evidence count changed: %d != %d'
                               % (verified, baseline['originalEvidenceVerified']))
        source = [f['evidence'] for s in manifest['states'] for f in s['files']]
        blob_entries = [e for e in descriptor['files'] if e['path'].startswith('blobs/')]
        all_entries = descriptor['files']
        blobs = stats(blob_entries)
        if blobs['duplicateFiles']:
            raise RuntimeError('content-addressed store contains repeated bytes')
        physical = [dict(path=p.name, bytes=p.stat().st_size, sha256=bundle.retention.digest(p))
                    for p in [scope / 'evidence.tar.gz', scope / 'evidence.tar.json']]
        fixture_names = ['captured/capture.json', 'captured/record.json',
                         'captured/before-reconciliation/answer.json', 'captured/after-reconciliation/answer.json']
        # Count active paths by presence, so this also works before staging.
        after_fixtures = [dict(path=name, bytes=(scope / name).stat().st_size)
                          for name in fixture_names if (scope / name).exists()]
        host = json.loads((restored / 'retention-execution.json').read_text())
        return dict(
            format='vaults-fixture-accounting-v1', baseCommit=baseline['baseCommit'],
            replacement='CIT-339 repeated historical input/captured trees and four derived answer presentations replaced by one CAS capsule and installed adapter. No PR152 fixture migration is claimed.',
            trackedResultFixtures=dict(before=baseline['trackedResultFixtures'],
                after=dict(files=len(after_fixtures), uncompressedBytes=sum(e['bytes'] for e in after_fixtures))),
            independentlyMaintainedResultDefinitions=dict(before=2, after=1,
                scope='Executable result expectations: original Question.pkl range plus replay.test.ts authored state/outcome matrix; now only the installed Question.pkl range. Replay expectations derive from retained raw outputs; documentation and generated evidence are not executable definitions.'),
            trackedInputPaths=dict(before=baseline['trackedInputPaths'], after=dict(materializedPaths=0,
                revisionPathReferences=len(source), uniqueInputBlobs=len({e['immutableId'] for e in source}),
                envPathReferences=sum(f['path'].endswith('.env') for s in manifest['states'] for f in s['files']))),
            retainedEvidence=dict(before=baseline['retainedEvidence'], after=dict(trackedStorageFiles=len(physical),
                trackedStorageBytes=sum(e['bytes'] for e in physical), capsule=stats(all_entries), contentAddressedBlobs=blobs,
                note='Retired answer JSONs remain immutable legacy evidence, not active result definitions. Both historical and newly reproduced outputs remain retained; identical bytes share one blob regardless of origin. Tar/gzip overhead and the descriptor are included in trackedStorageBytes.')),
            runtimeRetention=dict(snapshotId=host['snapshotId'], image=host['image'],
                imageArchiveBytes=host['imageArchiveBytes'], payloadFiles=host['payloadFiles'], payloadBytes=host['payloadBytes'],
                payloadDuplicateContentBytes=host['payloadDuplicateContentBytes'],
                note='Full runtime and original execution are retained separately in the exact local restic snapshot; excluded from fixture/capsule counts. Snapshot also contains a derived record presentation and orchestration logs. CI uploads each new full snapshot separately for 90 days.'),
            originalEvidenceVerified=verified,
        )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    value = report()
    output = ROOT / SCOPE / 'fixture-accounting.json'
    if args.check:
        if json.loads(output.read_text()) != value:
            raise RuntimeError('fixture accounting differs; regenerate it from the retained capsule')
    else:
        output.write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps(value['trackedResultFixtures']))
