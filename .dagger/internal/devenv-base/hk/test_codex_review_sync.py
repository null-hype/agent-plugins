"""Runs codex_review_sync from codex-review-sync.sh against a stubbed restic and gh."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent / 'codex-review-sync.sh'

HARNESS = r'''
set -euo pipefail
eval "$(sed -n '/^codex_review_sync() {$/,/^}$/p' "$SYNC_SCRIPT")"
gce_common_codex_changed_rollouts() { echo "snap $ROLLOUT"; }
restic() { cat "$ROLLOUT"; }
gh() {
  case "$1" in
    pr) echo 7 ;;
    api)
      if [[ " $* " == *" --input "* ]]; then
        cat > "$POSTS/$(ls "$POSTS" | wc -l).json"
        echo "https://github.com/o/r/pull/7#review"
      else
        for f in "$POSTS"/*.json; do if [ -e "$f" ]; then jq -c '{body}' "$f"; fi; done
      fi ;;
  esac
}
codex_review_sync
'''


def exited(explanation, correctness='patch is incorrect'):
    return {'type': 'event_msg', 'payload': {'item': {
        'type': 'ExitedReviewMode',
        'review_output': {
            'findings': [], 'overall_correctness': correctness,
            'overall_explanation': explanation, 'overall_confidence_score': 0.8}}}}


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.rollout = Path(self.tmp.name) / 'rollout.jsonl'
        self.posts = Path(self.tmp.name) / 'posts'
        self.posts.mkdir()
        self.lines = [{'type': 'session_meta', 'payload': {
            'id': 'sess-1',
            'git': {'repository_url': 'https://github.com/o/r.git',
                    'branch': 'feature', 'commit_hash': 'abc123'}}}]

    def sync(self):
        self.rollout.write_text(''.join(json.dumps(line) + '\n' for line in self.lines))
        result = subprocess.run(
            ['bash', '-c', HARNESS], capture_output=True, text=True, timeout=30,
            env=dict(os.environ, SYNC_SCRIPT=str(SCRIPT), ROLLOUT=str(self.rollout),
                     POSTS=str(self.posts)))
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def posted(self):
        return [json.loads(p.read_text())['body'] for p in sorted(self.posts.glob('*.json'))]

    def test_resync_of_unchanged_review_posts_once(self):
        self.lines.append(exited('first'))
        self.sync()
        result = self.sync()
        self.assertEqual(len(self.posted()), 1)
        self.assertIn('already posted', result.stderr)

    def seed_legacy_review(self, explanation, correctness='patch is incorrect'):
        body = (f'**Codex review:** {correctness} (confidence 0.8)\n\n{explanation}'
                '\n\n<!-- codex-session: sess-1 -->')
        (self.posts / f'{len(list(self.posts.iterdir()))}.json').write_text(
            json.dumps({'event': 'COMMENT', 'body': body}))

    def test_unchanged_verdict_already_posted_with_legacy_marker_is_not_reposted(self):
        self.seed_legacy_review('first')
        self.lines.append(exited('first'))
        result = self.sync()
        self.assertEqual(len(self.posted()), 1)
        self.assertIn('already posted', result.stderr)

    def test_later_verdict_after_legacy_marker_review_is_published(self):
        self.seed_legacy_review('first')
        self.lines.append(exited('second', correctness='patch is correct'))
        self.sync()
        bodies = self.posted()
        self.assertEqual(len(bodies), 2)
        self.assertIn('second', bodies[1])
        self.assertIn('codex-review:', bodies[1])
        self.sync()
        self.assertEqual(len(self.posted()), 2)

    def test_later_review_in_same_session_is_published(self):
        self.lines.append(exited('first'))
        self.sync()
        self.lines.append(exited('second', correctness='patch is correct'))
        self.sync()
        bodies = self.posted()
        self.assertEqual(len(bodies), 2)
        self.assertIn('first', bodies[0])
        self.assertIn('second', bodies[1])
        self.assertIn('patch is correct', bodies[1])
        self.assertNotEqual(bodies[0].rsplit('codex-review:', 1)[1],
                            bodies[1].rsplit('codex-review:', 1)[1])
        self.assertEqual(json.loads((self.posts / '1.json').read_text())['commit_id'], 'abc123')


if __name__ == '__main__':
    unittest.main()
