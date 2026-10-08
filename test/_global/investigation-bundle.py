#!/usr/bin/env python3
"""Restoration controls for the portable CAS bundle; no tools or vault access."""
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('bundle', root / 'scripts/investigation-bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class BundleRestoration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.scope = Path(self.temp.name)
        self.original = self.scope / 'original'
        self.original.mkdir()
        (self.original / 'blobs').mkdir()
        (self.original / 'blobs/input').write_bytes(b'original bytes\x00\n')
        (self.original / 'raw-output.txt').write_text('preserved original assessment')
        (self.original / 'record.json').write_text('derived presentation')
        (self.original / 'inputs.json').write_text(json.dumps(dict(
            inventory=dict(evidence=dict(uri='blobs/input')), states=[dict(files=[dict(evidence=dict(uri='blobs/input'))])])) )
        self.archive = self.scope / 'evidence.tar.gz'
        bundle.pack(self.original, self.archive)

    def test_full_and_input_only_restoration_preserve_bytes(self):
        restored = self.scope / 'restored'
        bundle.unpack(self.archive, restored)
        self.assertEqual((restored / 'blobs/input').read_bytes(), b'original bytes\x00\n')
        self.assertTrue((restored / 'raw-output.txt').is_file())
        self.assertFalse((restored / 'record.json').exists())
        inputs = self.scope / 'inputs'
        bundle.unpack(self.archive, inputs, inputs_only=True)
        self.assertEqual(bundle.retention.inventory(inputs), [e for e in bundle.retention.inventory(restored) if e['path'] in ('blobs/input', 'inputs.json')])
        bundle.pack(self.original, self.scope / 'second.tar.gz')
        self.assertEqual(self.archive.read_bytes(), (self.scope / 'second.tar.gz').read_bytes())

    def test_archive_corruption_is_refused(self):
        self.archive.write_bytes(self.archive.read_bytes() + b'changed')
        with self.assertRaisesRegex(RuntimeError, 'bundle changed'):
            bundle.unpack(self.archive, self.scope / 'out')

    def test_missing_evidence_is_refused_even_with_updated_archive_hash(self):
        (self.original / 'raw-output.txt').unlink()
        old = self.archive.with_suffix('.json').read_text()
        bundle.pack(self.original, self.archive)
        descriptor = json.loads(old)
        descriptor['sha256'] = bundle.retention.digest(self.archive)
        self.archive.with_suffix('.json').write_text(json.dumps(descriptor))
        with self.assertRaisesRegex(RuntimeError, 'payload differs'):
            bundle.unpack(self.archive, self.scope / 'out')

    def test_nonempty_restore_is_refused_without_overwriting(self):
        out = self.scope / 'out'
        out.mkdir()
        (out / 'earlier').write_text('keep')
        with self.assertRaisesRegex(RuntimeError, 'must be empty'):
            bundle.unpack(self.archive, out)
        self.assertEqual((out / 'earlier').read_text(), 'keep')

    def test_unsafe_and_duplicate_archive_members_are_refused(self):
        for i, name in enumerate(['../escape', '/absolute', 'same']):
            archive = self.scope / f'unsafe-{i}.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                for _ in range(2 if name == 'same' else 1):
                    entry = tarfile.TarInfo(name)
                    entry.size = 1
                    tar.addfile(entry, io.BytesIO(b'x'))
            archive.with_suffix('.json').write_text(json.dumps(dict(format='investigation-bundle-v1', sha256=bundle.retention.digest(archive), files=[])))
            with self.assertRaisesRegex(RuntimeError, 'unsafe retained member'):
                bundle.unpack(archive, self.scope / f'out-{i}')


if __name__ == '__main__':
    unittest.main()
