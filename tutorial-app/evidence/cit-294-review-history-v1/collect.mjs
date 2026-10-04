#!/usr/bin/env node
// CIT-306: provenance tool for the CIT-294 117 -> review -> 118 -> re-review -> 120 history.
//
// Like ../ghost-trace-v1/capture-ghost-trace-v1.mjs this is evidence, not build
// infrastructure: nothing in the app imports it and CI does not run it. It exists
// so the bundle's provenance is checkable.
//
//   node collect.mjs            read the pinned (revision, path) pairs below out of
//                               git objects, write files/<revision>/<path>, the raw
//                               commit objects and the git-derived facts, and
//                               regenerate manifest.json
//   node collect.mjs --verify   re-hash everything on disk against manifest.json.
//                               Needs no git history, so it also works on a
//                               checkout that lacks the reviewed commits.
//
// What it cannot do: the Linear comments, the issue description and the GitHub PR
// bodies in captures/ came through the Linear and GitHub connectors, and the API
// facts below were copied from connector responses. They are registered here with
// their origin, but they cannot be re-derived offline. See README.md.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const git = (args, opts = {}) => execFileSync('git', args, { cwd: here, maxBuffer: 1 << 26, ...opts });
const gitText = (args) => git(args, { encoding: 'utf8' }).trim();
const repoRoot = gitText(['rev-parse', '--show-toplevel']);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** git object id (SHA-1 object format): sha1("<type> <length>\0" + bytes). */
const gitObjectId = (type, bytes) =>
  createHash('sha1').update(Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`), bytes])).digest('hex');

const CK = 'docs/investigations/CIT-265/cit-294';
const MD = 'docs/investigations/CIT-265/CIT-294.md';
const LESSON = 'tutorial-app/src/content/tutorial/part-4/rails-matlab-canary';
const OBSERVATIONS = ['mat-unblocked', 'mat-blocked', 'png-unblocked', 'png-blocked'].map((n) => `${CK}/observations/${n}.json`);

/**
 * S1 and S2 are pinned to the commits the reviews cite (`20aafd2`, `8d097c8`), not to
 * the rebased equivalents on main (`390a787`, `9739b53`). Both spellings are recorded;
 * `treeEquality` below proves the bytes we bundle are identical under either.
 */
const STATES = {
  S1: { pr: 117, reviewed: '20aafd26372a832224be824f72f4a615ee671094', merged: '390a7873ea6fd639c1c735393848e03b05031cc3', label: '#117 as submitted and as review 1 saw it' },
  S2: { pr: 118, reviewed: '8d097c8e16bd1db44d5d4f558ad99938585e1001', merged: '9739b539de26919f1d1bb8129df8954de40dbfcd', label: '#118 as submitted and as review 2 saw it' },
  S3: { pr: 120, sha: '296ca9f87ea04809b4d21da5bd4d617784856c27', label: 'first commit of #120' },
  S4: { pr: 120, sha: 'cc23e89297855dd07b1ee477ced455ab46a94738', label: 'head of #120 (the final follow-up)' },
  S5: { sha: 'bc97c0e62fba3e66458e6b663ef4df5da37ebc31', label: 'merge commit of #120 on main' },
};
const pinned = (state) => STATES[state].reviewed ?? STATES[state].sha;

/** Only what an evidence reference points at is bundled; each file once per revision. */
const SELECTION = {
  S1: [MD, `${CK}/Reconcile.pkl`, `${CK}/cit294.test.pkl`, `${CK}/run_arms.sh`, `${CK}/canary-reads.txt`, ...OBSERVATIONS],
  S2: [
    `${CK}/Reconcile.pkl`, `${CK}/cit294.test.pkl`, `${CK}/run_arms.sh`, `${CK}/Observation.pkl`, `${CK}/diagnose.pkl`,
    `${CK}/reports/diagnostics.json`, `${CK}/reports/cit294.test.xml`, `${CK}/canary-reads.txt`, ...OBSERVATIONS,
  ],
  S3: [
    `${CK}/Reconcile.pkl`, `${CK}/cit294.test.pkl`, `${CK}/run_arms.sh`, `${CK}/Observation.pkl`, `${CK}/Claims.pkl`,
    `${CK}/reports/diagnostics.json`, `${CK}/reports/cit294.test.xml`, `${CK}/canary-reads.txt`, ...OBSERVATIONS,
    `${LESSON}/1-the-check-that-finally-checks/content.mdx`, `${LESSON}/meta.md`,
  ],
  S4: [
    MD, `${CK}/Reconcile.pkl`, `${CK}/cit294.test.pkl`, `${CK}/run_arms.sh`,
    `${CK}/reports/diagnostics.json`, `${CK}/reports/cit294.test.xml`, `${CK}/canary-reads.txt`, ...OBSERVATIONS,
    `${LESSON}/1-the-check-that-finally-checks/content.mdx`,
  ],
};

/** Raw commit objects: their SHA-1 is the revision id, so the file proves itself offline. */
const COMMIT_OBJECTS = ['S1', 'S2'].flatMap((s) => [STATES[s].reviewed, STATES[s].merged]).concat([STATES.S3.sha, STATES.S4.sha, STATES.S5.sha]);

/**
 * Copied from Linear / GitHub connector responses during the CIT-306 session
 * (2026-10-04). Not re-derivable offline; kept as data, not prose, so tests can read it.
 */
const API_FACTS = {
  source: 'GitHub pull_request_read(get) and Linear get_issue/list_comments connector responses, CIT-306 session, 2026-10-04',
  githubPullRequests: {
    117: { base: { ref: 'main', sha: 'be95c86ea1fddd8913cab7577f2405c1a2e90205' }, head: STATES.S1.merged, createdAt: '2026-10-04T01:04:29Z', mergedAt: '2026-10-04T03:57:33Z', commits: 1 },
    118: { base: { ref: 'cit-294-demonstrate-the-live-matlabhdf5-file-read-path-and-blocking', sha: STATES.S1.merged }, head: STATES.S2.merged, createdAt: '2026-10-04T02:07:28Z', mergedAt: '2026-10-04T03:57:34Z', commits: 1 },
    120: { base: { ref: 'cit-297-request-changes-to-strengthen-cit-294-evidence-validation', sha: STATES.S2.merged }, head: STATES.S4.sha, createdAt: '2026-10-04T02:54:49Z', mergedAt: '2026-10-04T03:57:35Z', commits: 2 },
  },
  linearIssues: {
    'CIT-294': { createdAt: '2026-10-03T22:56:40.809Z', completedAt: '2026-10-04T03:57:36.339Z', status: 'Done' },
    'CIT-297': { createdAt: '2026-10-04T01:16:30.258Z', completedAt: '2026-10-04T03:57:37.260Z', status: 'Done' },
    'CIT-303': { createdAt: '2026-10-04T02:17:24.340Z', completedAt: '2026-10-04T03:57:37.233Z', status: 'Done' },
  },
  linearComments: {
    'review-1': { id: '97e70a90-aae8-4bc2-90fa-1219f3584631', issue: 'CIT-294', createdAt: '2026-10-04T01:15:37.196Z', updatedAt: '2026-10-04T01:16:31.064Z' },
    'review-2': { id: '271bc302-e4a6-4e08-8577-f06b68805b74', issue: 'CIT-297', createdAt: '2026-10-04T02:16:12.197Z', updatedAt: '2026-10-04T02:17:24.404Z' },
  },
};

/** What was searched for review 3's original text, and what was found. A negative result, recorded as such. */
const REVIEW_3_RETRIEVAL_CHECK = {
  checkedOn: '2026-10-04',
  subject: 'original text of the third review (the review of PR #120 at 296ca9f)',
  found: false,
  checks: [
    { where: 'GitHub PR #120 reviews (pull_request_read get_reviews)', result: '[] (none)' },
    { where: 'GitHub PR #120 review threads (pull_request_read get_review_comments)', result: 'totalCount 0' },
    { where: 'GitHub PR #120 conversation comments (pull_request_read get_comments)', result: 'one comment, by netlify[bot] (deploy preview)' },
    { where: 'Linear diff threads for PR #117, #118 and #120 (get_diff_threads)', result: 'one thread each, by netlify[bot] (deploy preview); no drafts' },
    { where: 'Linear issue CIT-303 comments (list_comments)', result: '[] (none)' },
    { where: 'Linear issue CIT-297 comments (list_comments)', result: 'only 271bc302 (review 2)' },
    { where: 'Linear issue CIT-294 comments (list_comments)', result: 'only 97e70a90 (review 1)' },
  ],
  secondaryAccounts: [
    'git commit cc23e89 message (captures/git-commit-object-cc23e89297855dd07b1ee477ced455ab46a94738.txt)',
    'docs/investigations/CIT-265/CIT-294.md, section "Strengthened per the CIT-303 PR follow-up review", at cc23e89',
  ],
  notChecked: 'GitHub reviews on PR #117 and #118 were not re-queried here; CIT-305 reported none.',
};

/** Non-git captures: connector text saved by hand, registered here with its origin. */
const API_CAPTURES = [
  { captureId: 'linear:CIT-294:description', file: 'captures/linear-CIT-294-description.md', kind: 'linear-issue-description', origin: 'https://linear.app/citizen6librarian6refrain4/issue/CIT-294/demonstrate-the-live-matlabhdf5-file-read-path-and-blocking',
    note: 'Q0. Retrieved 2026-10-04, after the issue reached Done (completedAt 2026-10-04T03:57:36Z); the description may have been edited since it was created (2026-10-03T22:56:40Z) and Linear history was not consulted, so this is the text as retrieved, not proven to be the text as first written. Mentions appear as <issue>/<pull-request> tags: that is how the connector serializes them.' },
  { captureId: 'linear:CIT-294:comment:97e70a90', file: 'captures/linear-CIT-294-comment-97e70a90.md', kind: 'linear-comment', origin: 'https://linear.app/citizen6librarian6refrain4/issue/CIT-294/demonstrate-the-live-matlabhdf5-file-read-path-and-blocking#comment-97e70a90',
    note: 'Review 1, of PR #117 at 20aafd26. Comment body as retrieved; the comment was edited 54s after it was created (createdAt 01:15:37Z, updatedAt 01:16:31Z).' },
  { captureId: 'linear:CIT-297:comment:271bc302', file: 'captures/linear-CIT-297-comment-271bc302.md', kind: 'linear-comment', origin: 'https://linear.app/citizen6librarian6refrain4/issue/CIT-297/request-changes-to-strengthen-cit-294-evidence-validation#comment-271bc302',
    note: 'Review 2, of PR #118 at 8d097c8e. Comment body as retrieved; edited 72s after it was created (createdAt 02:16:12Z, updatedAt 02:17:24Z).' },
  { captureId: 'github:pr:117:body', file: 'captures/github-pr-117-body.md', kind: 'github-pr-body', origin: 'https://github.com/null-hype/agent-plugins/pull/117', note: 'PR body as retrieved on 2026-10-04 (state: merged).' },
  { captureId: 'github:pr:118:body', file: 'captures/github-pr-118-body.md', kind: 'github-pr-body', origin: 'https://github.com/null-hype/agent-plugins/pull/118', note: 'PR body as retrieved on 2026-10-04 (state: merged). Carries the claim review 2 contested.' },
  { captureId: 'github:pr:120:body', file: 'captures/github-pr-120-body.md', kind: 'github-pr-body', origin: 'https://github.com/null-hype/agent-plugins/pull/120', note: 'PR body as retrieved on 2026-10-04 (state: merged). Describes 296ca9f (25 facts / 71 asserts); the merged head cc23e89 has 29 / 75.' },
];

const bundleFile = (rel) => join(here, rel);
const writeBundle = (rel, bytes) => {
  mkdirSync(dirname(bundleFile(rel)), { recursive: true });
  writeFileSync(bundleFile(rel), bytes);
};
const stable = (value) => `${JSON.stringify(value, null, 2)}\n`;

function ensureCommit(sha) {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    // The reviewed commits are not reachable from main; GitHub still serves them by full SHA.
    git(['fetch', 'origin', sha]);
  }
}

function countSections(pkl) {
  let section = null;
  const count = { facts: 0, examples: 0 };
  for (const line of pkl.split('\n')) {
    if (/^facts \{/.test(line)) section = 'facts';
    else if (/^examples \{/.test(line)) section = 'examples';
    else if (section && /^  \["/.test(line)) count[section] += 1;
  }
  return count;
}

/** `git patch-id --stable` of one commit: equal ids mean the same change on a different parent. */
const patchId = (sha) =>
  execFileSync('git', ['patch-id', '--stable'], { cwd: here, input: git(['show', sha]), encoding: 'utf8' }).split(' ')[0];

const gitObjectExists = (spec) => {
  try {
    // A missing path is the answer here, not an error worth printing.
    execFileSync('git', ['cat-file', '-e', spec], { cwd: here, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const isAncestor = (a, b) => {
  try {
    git(['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
};

function collect() {
  for (const s of Object.values(STATES)) for (const sha of [s.reviewed, s.merged, s.sha].filter(Boolean)) ensureCommit(sha);

  const files = [];
  for (const [state, paths] of Object.entries(SELECTION)) {
    const revision = pinned(state);
    for (const path of paths) {
      const bytes = git(['cat-file', 'blob', `${revision}:${path}`]);
      const blobId = gitText(['rev-parse', `${revision}:${path}`]);
      if (gitObjectId('blob', bytes) !== blobId) throw new Error(`blob id mismatch for ${revision}:${path}`);
      const file = `files/${revision}/${path}`;
      writeBundle(file, bytes);
      files.push({ state, revision, path, blobId, sha256: sha256(bytes), bytes: bytes.length, file });
    }
  }

  const captures = API_CAPTURES.map((c) => {
    const bytes = readFileSync(bundleFile(c.file));
    return { ...c, sha256: sha256(bytes), bytes: bytes.length };
  });

  for (const sha of COMMIT_OBJECTS) {
    const bytes = git(['cat-file', 'commit', sha]);
    if (gitObjectId('commit', bytes) !== sha) throw new Error(`commit object does not hash to ${sha}`);
    const file = `captures/git-commit-object-${sha}.txt`;
    writeBundle(file, bytes);
    captures.push({
      captureId: `git:commit-object:${sha}`, file, kind: 'git-commit-object', commitId: sha,
      origin: `git cat-file commit ${sha}`, note: 'Raw commit object: tree, parents, author, committer, message. sha1("commit <len>\\0" + bytes) is the commit id.',
      sha256: sha256(bytes), bytes: bytes.length,
    });
  }

  const landingGit = {
    mergeCommit: STATES.S5.sha,
    parents: gitText(['rev-list', '--parents', '-n', '1', STATES.S5.sha]).split(' ').slice(1),
    ancestorOfMergeCommit: Object.fromEntries(
      ['S1', 'S2'].flatMap((s) => [[`${s}.reviewed`, STATES[s].reviewed], [`${s}.merged`, STATES[s].merged]])
        .concat([['S3', STATES.S3.sha], ['S4', STATES.S4.sha]])
        .map(([k, sha]) => [k, isAncestor(sha, STATES.S5.sha)]),
    ),
    lessonBlobAtS3: gitText(['rev-parse', `${STATES.S3.sha}:${LESSON}/1-the-check-that-finally-checks/content.mdx`]),
    lessonBlobAtS4: gitText(['rev-parse', `${STATES.S4.sha}:${LESSON}/1-the-check-that-finally-checks/content.mdx`]),
    // Review 2 says no TutorialKit page connects this run; these are the revisions where it exists.
    tutorialPagePresent: Object.fromEntries(
      ['S1', 'S2', 'S3', 'S4'].map((s) => [s, gitObjectExists(`${pinned(s)}:${LESSON}`)]),
    ),
    tutorialPagePath: LESSON,
  };
  const gitFacts = { file: 'captures/git-landing-facts.json', captureId: 'git:landing-facts', kind: 'git-derived-facts', origin: 'git rev-list / merge-base / rev-parse run by collect.mjs', note: 'Derived by collect.mjs from git objects on the collection date.', body: stable(landingGit) };
  const apiFacts = { file: 'captures/api-landing-facts.json', captureId: 'api:landing-facts', kind: 'api-derived-facts', origin: API_FACTS.source, note: 'Copied from connector responses; not re-derivable offline.', body: stable(API_FACTS) };
  const retrieval = { file: 'captures/review-3-retrieval-check.json', captureId: 'cit-306:review-3-retrieval-check', kind: 'retrieval-check', origin: 'searches made during the CIT-306 session', note: 'A negative result: where the original text of review 3 was looked for and not found.', body: stable(REVIEW_3_RETRIEVAL_CHECK) };
  for (const { body, ...rest } of [gitFacts, apiFacts, retrieval]) {
    const bytes = Buffer.from(body);
    writeBundle(rest.file, bytes);
    captures.push({ ...rest, sha256: sha256(bytes), bytes: bytes.length });
  }

  const revisions = {};
  for (const [state, s] of Object.entries(STATES)) {
    const commit = (sha) => {
      const [author, authorTime, committer, committerTime] = gitText(['log', '-1', '--format=%an%n%aI%n%cn%n%cI', sha]).split('\n');
      const header = git(['cat-file', 'commit', sha]).toString('utf8').split('\n\n')[0];
      return {
        sha,
        author, authorTime, committer, committerTime,
        signed: /^gpgsig /m.test(header),
        // GitHub re-creates (and signs) a PR's commits when it rebases them, which is what the stack merge did.
        rewrittenByGitHub: committer === 'GitHub',
        parent: gitText(['rev-list', '--parents', '-n', '1', sha]).split(' ')[1] ?? null,
        reachableFromMain: isAncestor(sha, 'origin/main'),
      };
    };
    const entry = { label: s.label, pr: s.pr ?? null, pinned: pinned(state) };
    if (s.reviewed) {
      entry.reviewed = commit(s.reviewed);
      entry.merged = commit(s.merged);
      entry.patchId = { reviewed: patchId(s.reviewed), merged: patchId(s.merged) };
      entry.treeEquality = [CK, MD].map((path) => {
        const reviewed = gitText(['rev-parse', `${s.reviewed}:${path}`]);
        const merged = gitText(['rev-parse', `${s.merged}:${path}`]);
        return { path, kind: path === MD ? 'blob' : 'tree', reviewed, merged, equal: reviewed === merged };
      });
    } else {
      entry.commit = commit(s.sha);
      // No reviewed spelling is recorded for S3/S4: the only retrievable commits are GitHub's rewritten ones.
      if (entry.commit.rewrittenByGitHub && state !== 'S5') {
        entry.originalSha = null;
        entry.originalShaNote = 'GitHub re-created this commit when the stack was merged (committer GitHub, signed). The commit it replaced is not recorded in any source retrieved for this bundle, so what the reviewers saw cannot be compared byte for byte. Corroboration only, not proof: the author time is the original one, and the PR #120 body (written before the rewrite) reports the same fact totals that the pinned bytes recount to.';
      }
    }
    const testPkl = files.find((f) => f.state === state && f.path === `${CK}/cit294.test.pkl`);
    if (testPkl) entry.counts = countSections(readFileSync(bundleFile(testPkl.file), 'utf8'));
    revisions[state] = entry;
  }

  const manifest = {
    bundleId: 'cit-294-review-history-v1',
    repository: 'https://github.com/null-hype/agent-plugins',
    collectedOn: '2026-10-04',
    collector: 'tutorial-app/evidence/cit-294-review-history-v1/collect.mjs',
    revisions,
    files,
    captures,
  };
  writeBundle('manifest.json', Buffer.from(stable(manifest)));
  console.log(`bundled ${files.length} files at ${new Set(files.map((f) => f.revision)).size} revisions and ${captures.length} captures`);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function verify() {
  const manifest = JSON.parse(readFileSync(bundleFile('manifest.json'), 'utf8'));
  const problems = [];
  const listed = new Set();
  for (const f of manifest.files) {
    listed.add(f.file);
    if (!existsSync(bundleFile(f.file))) { problems.push(`missing file ${f.file}`); continue; }
    const bytes = readFileSync(bundleFile(f.file));
    if (gitObjectId('blob', bytes) !== f.blobId) problems.push(`blob id mismatch ${f.file}`);
    if (sha256(bytes) !== f.sha256) problems.push(`sha256 mismatch ${f.file}`);
    if (bytes.length !== f.bytes) problems.push(`length mismatch ${f.file}`);
  }
  for (const c of manifest.captures) {
    listed.add(c.file);
    if (!existsSync(bundleFile(c.file))) { problems.push(`missing capture ${c.file}`); continue; }
    const bytes = readFileSync(bundleFile(c.file));
    if (sha256(bytes) !== c.sha256) problems.push(`sha256 mismatch ${c.file}`);
    if (c.kind === 'git-commit-object' && gitObjectId('commit', bytes) !== c.commitId) problems.push(`commit object does not hash to ${c.commitId}`);
  }
  for (const full of [...walk(bundleFile('files')), ...walk(bundleFile('captures'))]) {
    const rel = relative(here, full);
    if (!listed.has(rel)) problems.push(`unlisted file ${rel}`);
  }
  for (const [state, r] of Object.entries(manifest.revisions)) {
    for (const t of r.treeEquality ?? []) if (t.equal !== (t.reviewed === t.merged)) problems.push(`${state} treeEquality flag disagrees for ${t.path}`);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`verified ${manifest.files.length} files and ${manifest.captures.length} captures against manifest.json`);
}

if (process.argv.includes('--verify')) verify();
else collect();
