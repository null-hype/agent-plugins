"""Checks that verification cannot certify incomplete or contradictory evidence."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('verify', Path(__file__).with_name('cve-restic-verify.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class VerificationTest(unittest.TestCase):
    def test_empty_file_is_distinct_from_missing_and_extra_files_are_reported(self):
        result = verify.compare_files({'/empty': '', '/missing': '', '/changed': 'old'},
                                      {'/empty': b'', '/extra': b'', '/changed': b'new'})
        self.assertEqual({r['path']: r['status'] for r in result},
                         {'/changed': 'different', '/empty': 'match', '/extra': 'unexpected', '/missing': 'missing'})

    def test_diff_reports_both_missing_and_unexpected_changes(self):
        result = verify.compare_diff([dict(path='/a', kind='removed')],
                                     [dict(message_type='change', path='/a', modifier='M')])
        self.assertEqual(result['status'], 'different')
        self.assertEqual(result['missing'], [dict(path='/a', kind='removed')])
        self.assertEqual(result['unexpected'], [dict(path='/a', kind='modified')])

    def test_diff_compares_content_changes_without_metadata_noise(self):
        events = [dict(message_type='change', path='/a', modifier='+'),
                  dict(message_type='change', path='/b', modifier='-'),
                  dict(message_type='change', path='/c', modifier='M'),
                  dict(message_type='change', path='/d', modifier='U'),
                  dict(message_type='statistics', changed_files=1)]
        expected = [dict(path='/c', kind='modified'), dict(path='/a', kind='added'), dict(path='/b', kind='removed')]
        self.assertEqual(verify.compare_diff(expected, events)['status'], 'match')

    def test_unknown_change_is_collection_failure(self):
        with self.assertRaises(RuntimeError):
            verify.compare_diff([], [dict(message_type='change', path='/a', modifier='T')])


if __name__ == '__main__':
    unittest.main()
