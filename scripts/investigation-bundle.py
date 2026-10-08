#!/usr/bin/env python3
"""Portable, deduplicated scopes for the existing capture/retention lifecycle."""
import argparse
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile

spec = importlib.util.spec_from_file_location('retention', Path(__file__).with_name('cve-checker-retention.py'))
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


def pack(root, archive):
    # Presentation is derived on demand; never retain another active answer key.
    entries = [e for e in retention.inventory(root) if e['path'] != 'record.json']
    archive.parent.mkdir(parents=True, exist_ok=True)
    with archive.open('wb') as raw, gzip.GzipFile(fileobj=raw, filename='', mode='wb', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w') as tar:
        for entry in entries:
            member = tarfile.TarInfo(entry['path'])
            member.size = entry['bytes']
            member.mode = 0o644
            tar.addfile(member, io.BytesIO((root / entry['path']).read_bytes()))
    descriptor = dict(format='investigation-bundle-v1', sha256=retention.digest(archive), files=entries)
    if (root / 'execution.json').exists():
        descriptor['executionId'] = json.loads((root / 'execution.json').read_text())['id']
    retention.write_json(archive.with_suffix('.json'), descriptor)
    return descriptor


def unpack(archive, output, inputs_only=False):
    descriptor = json.loads(archive.with_suffix('.json').read_text())
    if descriptor['format'] != 'investigation-bundle-v1' or retention.digest(archive) != descriptor['sha256']:
        raise RuntimeError('retained bundle changed')
    retention.fresh(output)
    with tempfile.TemporaryDirectory(prefix='investigation-bundle-') as temporary:
        scope = Path(temporary)
        seen = set()
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                target = scope / member.name
                if not member.isfile() or member.name.startswith('/') or '..' in Path(member.name).parts or member.name in seen:
                    raise RuntimeError('unsafe retained member')
                seen.add(member.name)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(tar.extractfile(member).read())
        retention.verify(scope, descriptor['files'])
        if inputs_only:
            manifest = json.loads((scope / 'inputs.json').read_text())
            names = {'inputs.json', manifest['inventory']['evidence']['uri']}
            names.update(f['evidence']['uri'] for s in manifest['states'] for f in s['files'])
        else:
            names = {e['path'] for e in descriptor['files']}
        for name in sorted(names):
            if name not in seen:
                raise RuntimeError('input reference is outside the retained bundle: ' + name)
            target = output / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((scope / name).read_bytes())
    return descriptor


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['pack', 'unpack', 'inputs'])
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.action == 'pack':
        pack(args.source.resolve(), args.output.resolve())
    else:
        unpack(args.source.resolve(), args.output.resolve(), args.action == 'inputs')
