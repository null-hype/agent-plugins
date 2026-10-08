#!/usr/bin/env python3
"""Account for CIT-339's replaced representations, separately from retained evidence."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = 'dea80d7c9a01875bf644ae8fbbaf0ff14b24665b'
SCOPE = '.dagger/internal/devenv-base/pkl/vaults-replay'
spec = importlib.util.spec_from_file_location('bundle', ROOT / 'scripts/investigation-bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def stats(entries):
    unique = {e['sha256']: e['bytes'] for e in entries}
    size = sum(e['bytes'] for e in entries)
    return dict(files=len(entries), uncompressedBytes=size, uniqueContents=len(unique),
                uniqueContentBytes=sum(unique.values()), duplicateFiles=len(entries) - len(unique),
                duplicateContentBytes=size - sum(unique.values()))


def report():
    names = git('ls-tree', '-r', '--name-only', BASE, SCOPE).decode().splitlines()
    old = {}
    for name in names:
        data = git('show', BASE + ':' + name)
        old[name.removeprefix(SCOPE + '/')] = dict(path=name, bytes=len(data),
            sha256='sha256:' + hashlib.sha256(data).hexdigest())
    fixture_names = ['captured/capture.json', 'captured/record.json',
                     'captured/before-reconciliation/answer.json', 'captured/after-reconciliation/answer.json']
    prior = [e for name, e in old.items() if name.startswith(('inputs/', 'captured/')) or name == 'manifest.json']
    fixtures = [old[name] for name in fixture_names]
    scope = ROOT / SCOPE
    with tempfile.TemporaryDirectory(prefix='vaults-accounting-') as temporary:
        restored = Path(temporary) / 'scope'
        descriptor = bundle.unpack(scope / 'evidence.tar.gz', restored)
        manifest = json.loads((restored / 'inputs.json').read_text())
        legacy = json.loads((restored / 'legacy.json').read_text())
        # Every historical path's bytes remain accessible, including retired
        # generated presentation. None of these is an active answer fixture.
        refs = legacy['paths']
        for name, entry in old.items():
            if name.startswith(('inputs/', 'captured/')):
                retained = refs[name]
                if retained['immutableId'] != entry['sha256']:
                    raise RuntimeError('original evidence identity changed: ' + name)
                if bundle.retention.digest(restored / retained['uri']) != entry['sha256']:
                    raise RuntimeError('original evidence bytes changed: ' + name)
        source = [f['evidence'] for s in manifest['states'] for f in s['files']]
        blob_entries = [e for e in descriptor['files'] if e['path'].startswith('blobs/')]
        all_entries = descriptor['files']
        blobs = stats(blob_entries)
        if blobs['duplicateFiles']:
            raise RuntimeError('content-addressed store contains repeated bytes')
        physical = [dict(path=p.name, bytes=p.stat().st_size, sha256=bundle.retention.digest(p))
                    for p in [scope / 'evidence.tar.gz', scope / 'evidence.tar.json']]
        # Count active paths by presence, so this also works before staging.
        after_fixtures = [dict(path=name, bytes=(scope / name).stat().st_size)
                          for name in fixture_names if (scope / name).exists()]
        prior_sources = [e for name, e in old.items()
                         if name.startswith(('inputs/0/', 'inputs/1/')) or '/inputs/.dagger/' in name
                         or '/inputs/test/' in name or name.endswith('/inputs/.env')]
        host = json.loads((restored / 'retention-execution.json').read_text())
        return dict(
            format='vaults-fixture-accounting-v1', baseCommit=BASE,
            replacement='CIT-339 repeated historical input/captured trees and four derived answer presentations replaced by one CAS capsule and installed adapter. No PR152 fixture migration is claimed.',
            trackedResultFixtures=dict(before=dict(files=len(fixtures), uncompressedBytes=sum(e['bytes'] for e in fixtures)),
                after=dict(files=len(after_fixtures), uncompressedBytes=sum(e['bytes'] for e in after_fixtures))),
            independentlyMaintainedResultDefinitions=dict(before=2, after=1,
                scope='Executable result expectations: original Question.pkl range plus replay.test.ts authored state/outcome matrix; now only the installed Question.pkl range. Replay expectations derive from retained raw outputs; documentation and generated evidence are not executable definitions.'),
            trackedInputPaths=dict(before=stats(prior_sources), after=dict(materializedPaths=0,
                revisionPathReferences=len(source), uniqueInputBlobs=len({e['immutableId'] for e in source}),
                envPathReferences=sum(f['path'].endswith('.env') for s in manifest['states'] for f in s['files']))),
            retainedEvidence=dict(before=stats(prior), after=dict(trackedStorageFiles=len(physical),
                trackedStorageBytes=sum(e['bytes'] for e in physical), capsule=stats(all_entries), contentAddressedBlobs=blobs,
                note='Retired answer JSONs remain immutable legacy evidence, not active result definitions. Both historical and newly reproduced outputs remain retained; identical bytes share one blob regardless of origin. Tar/gzip overhead and the descriptor are included in trackedStorageBytes.')),
            runtimeRetention=dict(snapshotId=host['snapshotId'], image=host['image'],
                imageArchiveBytes=host['imageArchiveBytes'], payloadFiles=host['payloadFiles'], payloadBytes=host['payloadBytes'],
                payloadDuplicateContentBytes=host['payloadDuplicateContentBytes'],
                note='Full runtime and original execution are retained separately in the exact local restic snapshot; excluded from fixture/capsule counts. Snapshot also contains a derived record presentation and orchestration logs. CI uploads each new full snapshot separately for 90 days.'),
            originalEvidenceVerified=len([n for n in old if n.startswith(('inputs/', 'captured/'))]),
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
