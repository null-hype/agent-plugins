import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROPOSAL_LINES, type MergeResult } from '../../src/lib/budgetAuthorityStoryboard';

// CIT-251 turn 2 is a real merge, not a stated one: two branches off one
// base, each adding one line of proposal P, merged with plain `git merge`.
// Identity, dates and the default branch are pinned so the tree id (and so
// every compiled lesson) is byte-identical across runs.
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'storyboard',
  GIT_AUTHOR_EMAIL: 'storyboard@example.invalid',
  GIT_AUTHOR_DATE: '2026-09-22T00:00:00Z',
  GIT_COMMITTER_NAME: 'storyboard',
  GIT_COMMITTER_EMAIL: 'storyboard@example.invalid',
  GIT_COMMITTER_DATE: '2026-09-22T00:00:00Z',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

export function mergeProposalBranches(): MergeResult {
  const dir = mkdtempSync(path.join(tmpdir(), 'budget-authority-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    writeFileSync(path.join(dir, 'README'), 'proposal P\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    for (const line of PROPOSAL_LINES) {
      git('checkout', '-q', '-b', line.item, 'main');
      mkdirSync(path.join(dir, 'proposal'), { recursive: true });
      writeFileSync(path.join(dir, 'proposal', `${line.item}.json`), `${JSON.stringify(line)}\n`);
      git('add', '.');
      git('commit', '-qm', `${line.item} ${line.amount}`);
    }
    git('checkout', '-q', PROPOSAL_LINES[0].item);
    git('merge', '-q', '--no-edit', PROPOSAL_LINES[1].item);
    const unmerged = git('diff', '--name-only', '--diff-filter=U');
    return { tree: git('rev-parse', 'HEAD:proposal'), conflicts: unmerged ? unmerged.split('\n').length : 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
