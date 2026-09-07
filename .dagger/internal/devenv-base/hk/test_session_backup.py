"""Regression checks using fake backup commands and a disposable real restic repo."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

LIB = Path(__file__).resolve().parent.parent / '.devcontainer/lib/gce-common.sh'


def shell(code, env=None):
    return subprocess.run(['bash', '-c', 'set -euo pipefail; source "$TEST_LIB"; ' + code],
                          env=dict(os.environ, TEST_LIB=str(LIB), **(env or {})),
                          capture_output=True, text=True, timeout=30)


class BackupTests(unittest.TestCase):
    def test_failure_does_not_skip_other_snapshots_or_prune(self):
        result = shell('''
          gce_common_restic_push_claude_session() { echo CLAUDE; return 7; }
          gce_common_restic_push_container_use_state() { echo CONTAINER_USE; }
          gce_common_restic_push_codex_session() { echo CODEX; }
          gce_common_restic_prune() { echo PRUNE; }
          gce_common_restic_push_sessions
        ''')
        self.assertEqual(result.returncode, 1)
        self.assertIn('CONTAINER_USE', result.stdout)
        self.assertIn('CODEX', result.stdout)
        self.assertNotIn('PRUNE', result.stdout)

    @unittest.skipUnless(Path(os.environ.get("CODEX_HOME", str(Path.home()/".codex"))).is_dir(), "no local Codex directory")
    def test_codex_has_own_tag_and_directory(self):
        result = shell('''
          gce_common_restic_retry() { printf '%s\\n' "$@"; }
          gce_common_restic_push_codex_session
        ''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(),
                         ['backup', os.environ.get('CODEX_HOME', str(Path.home()/'.codex')),
                          '--tag', 'codex-session-state'])

    def test_best_effort_is_explicit(self):
        with tempfile.TemporaryDirectory() as temp:
            fake = Path(temp)/'pass-cli'
            fake.write_text('#!/bin/sh\necho "authentication failed" >&2\nexit 9\n')
            fake.chmod(0o755)
            env = dict(os.environ, PATH=temp+':'+os.environ['PATH'])
            script = LIB.parent.parent.parent/'hk/claude-session-backup.sh'
            direct = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True)
            hook = subprocess.run(['bash', str(script), '--best-effort'], env=env, capture_output=True, text=True)
            self.assertEqual(direct.returncode, 9)
            self.assertEqual(hook.returncode, 0)
            self.assertIn('session backup FAILED', hook.stderr)

    def test_non_lock_failure_not_retried(self):
        result = shell('''
          restic() { echo CALLED; echo 'authentication failed' >&2; return 9; }
          gce_common_restic_retry backup irrelevant
        ''')
        self.assertEqual(result.returncode, 9)
        self.assertEqual(result.stdout.count('CALLED'), 1)

    def test_lock_deadline_reports_failure(self):
        result = shell('''
          restic() { echo 'repository is already locked' >&2; return 1; }
          gce_common_restic_retry backup irrelevant
        ''', {'RESTIC_LOCK_RETRY_SECONDS': '0'})
        self.assertEqual(result.returncode, 1)
        self.assertIn('repository is already locked', result.stderr)

    def test_real_active_lock_waits_without_unlocking(self):
        with tempfile.TemporaryDirectory() as temp:
            env = dict(RESTIC_REPOSITORY=temp+'/repo', RESTIC_PASSWORD='disposable-test-password',
                       RESTIC_CACHE_DIR=temp+'/cache', RESTIC_LOCK_RETRY_SECONDS='10')
            process_env = dict(os.environ, **env)
            subprocess.run(['restic', 'init'], env=process_env, check=True, capture_output=True)
            blocker = subprocess.Popen(['restic', 'backup', '--stdin', '--stdin-filename', 'fixture'],
                                       env=process_env, stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic()+10
                while not list(Path(temp+'/repo/locks').glob('*')):
                    if time.monotonic() > deadline:
                        self.fail('backup did not acquire lock')
                    time.sleep(.05)
                waiter = subprocess.Popen(['bash', '-c',
                    'set -euo pipefail; source "$TEST_LIB"; gce_common_restic_retry forget --keep-last 50 --prune'],
                    env=dict(process_env, TEST_LIB=str(LIB)), stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, text=True)
                time.sleep(1)
                self.assertIsNone(waiter.poll(), 'retention did not wait for active lock')
                blocker.communicate(b'transcript fixture\n', timeout=10)
                self.assertEqual(blocker.returncode, 0)
                out, err = waiter.communicate(timeout=20)
                self.assertEqual(waiter.returncode, 0, out+err)
                self.assertIn('repository busy', err)
                snapshots = json.loads(subprocess.check_output(['restic', 'snapshots', '--json'], env=process_env))
                self.assertEqual(len(snapshots), 1, 'active backup was lost')
            finally:
                if blocker.poll() is None:
                    blocker.kill()
                    blocker.communicate()


if __name__ == '__main__':
    unittest.main()
