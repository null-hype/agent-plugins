import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LIMIT_V1, PROPOSAL_LINES, evaluateBudget, type BudgetEvaluation, type MergeResult } from '../../src/lib/budgetAuthorityStoryboard';

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

type ProposalWorld = {
  commit: string;
  tree: string;
  parents: string[];
  lines: { item: string; amount: number }[];
  evaluation: BudgetEvaluation;
};

export type ProposalComposition = MergeResult & {
  rule: Readonly<typeof LIMIT_V1>;
  worlds: Record<'base' | 'airfare' | 'ground' | 'merged', ProposalWorld>;
};

export function mergeProposalBranches(): ProposalComposition {
  const dir = mkdtempSync(path.join(tmpdir(), 'budget-authority-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  // The governing rule lives outside the worker branches. Every world is
  // evaluated by the same function against this one frozen v1 rule.
  const rule = Object.freeze({ ...LIMIT_V1 });
  const readWorld = (ref: string): ProposalWorld => {
    const files = git('ls-tree', '-r', '--name-only', ref, '--', 'proposal').split('\n').filter(Boolean);
    const lines = files.map((file) => JSON.parse(git('show', `${ref}:${file}`)) as { item: string; amount: number });
    return {
      commit: git('rev-parse', ref),
      tree: git('rev-parse', `${ref}^{tree}`),
      parents: git('show', '-s', '--format=%P', ref).split(' ').filter(Boolean),
      lines,
      evaluation: evaluateBudget(lines, rule),
    };
  };
  try {
    git('init', '-q');
    writeFileSync(path.join(dir, 'README'), 'proposal P\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = readWorld('main');
    const branches: ProposalWorld[] = [];
    for (const line of PROPOSAL_LINES) {
      git('checkout', '-q', '-b', line.item, 'main');
      mkdirSync(path.join(dir, 'proposal'), { recursive: true });
      writeFileSync(path.join(dir, 'proposal', `${line.item}.json`), `${JSON.stringify(line)}\n`);
      git('add', '.');
      git('commit', '-qm', `${line.item} ${line.amount}`);
      branches.push(readWorld('HEAD'));
    }
    git('checkout', '-q', PROPOSAL_LINES[0].item);
    git('merge', '-q', '--no-edit', PROPOSAL_LINES[1].item);
    const unmerged = git('diff', '--name-only', '--diff-filter=U');
    return {
      tree: git('rev-parse', 'HEAD:proposal'),
      conflicts: unmerged ? unmerged.split('\n').length : 0,
      rule,
      worlds: { base, airfare: branches[0], ground: branches[1], merged: readWorld('HEAD') },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
