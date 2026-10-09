// CIT-365 / CIT-376 / CIT-385: the investigation data the Investigation stories
// render and the module's vitest exercises. Kept out of `Investigation.stories.tsx`
// (a CSF file, every export of which Storybook treats as a story, and which
// pulls in `monaco-editor`) so `investigationModel.spec.ts` can import it under
// vitest in node. Made-up values on the private-file case (#117); the snapshot
// model (CIT-371) supplies them later.
import type { Investigation } from '../lib/investigationModel';

const realRead = '[pid    16] openat(AT_FDCWD</app>, "/work/dummy-canary.txt", O_RDONLY) = 14</work/dummy-canary.txt>';
const canaryReads = (withRead: boolean) => [
  '### ARM: mat-unblocked',
  '== strace openat evidence for the canary/control file ==',
  '[pid    10] openat(AT_FDCWD</app>, "/work/canary.mat", O_RDONLY|O_CLOEXEC) = 6</work/canary.mat>',
  ...(withRead ? [realRead] : []),
  '  "source_path": "/work/canary.mat",',
  '',
].join('\n');

const forgedRead = `{
  "arm": "mat",
  "source_path": "/work/canary.mat",
  "loader_selected": "matload",
  "variant_succeeded": true,
  "returned_bytes_hex": "4b5232532d43414e4152592d4349543239342d30313233343536373839616263",
  "matches_dummy_file": true,
  "recovered_text": "\\"KR2S-CANARY-CIT294-0123456789abc\\"",
  "expected_text": "\\"KR2S-CANARY-CIT294-0123456789abc\\""
}
`;

// The check, as each pull request left it: the rule that decides whether an
// observation counts as a real read of the private file.
const reconcile = (lines: string[]) => [
  '/// Does an observation show a real read of the private file?',
  'module cit294.Reconcile',
  '',
  'import "Observation.pkl"',
  '',
  'function readPrivateFile(o: Observation.Observed, trace: String): Boolean =',
  ...lines,
  '',
].join('\n');
const matches = '  o.matches_dummy_file == true';
export const sameText = '  && o.recovered_text == o.expected_text';
const traced = '  && trace.contains("openat(AT_FDCWD</app>, \\"/work/dummy-canary.txt\\"")';
export const RULE = 6;

export const investigation: Investigation = {
  vault: 'investigations',
  question: 'Can an upload read a private file?',
  agent: [
    {
      tag: 'Does the check fail when a read of the private file is forged?',
      snapshot: '32e5155e',
      evidence: 'Forging the read still left all 28 assertions passing.',
      changes: [
        {
          kind: 'A',
          path: 'inputs/observations/forged-read.json',
          note: "Shouldn't be here: a forged read of the private file, and the check still passed (28 of 28).",
          contents: forgedRead,
          finding: { line: 7, message: 'This read never happened: no process opened /work/dummy-canary.txt (see canary-reads.txt).' },
          verdicts: [
            { revision: '#117', passed: true, check: { path: 'inputs/Reconcile.pkl', rule: RULE, contents: reconcile([matches]),
              note: 'Takes the observation at its word: a forged one passes.' } },
            { revision: '#118', passed: true, check: { path: 'inputs/Reconcile.pkl', rule: RULE, contents: reconcile([matches, sameText]),
              note: 'Stronger, but still only reads the observation: a forged one that copies the text passes.' } },
            { revision: '#120', passed: false, check: { path: 'inputs/Reconcile.pkl', rule: RULE, contents: reconcile([matches, sameText, traced]),
              note: 'Requires the trace to show the read: a forged observation fails.' } },
          ],
        },
        {
          kind: 'M',
          path: 'inputs/canary-reads.txt',
          note: 'The real read is gone from the trace.',
          contents: canaryReads(false),
          baseline: canaryReads(true),
        },
      ],
    },
    {
      tag: 'Can the check tell a real block from a generic crash?',
      snapshot: '3c0f3a7e',
      evidence: 'A generic crash made the check fail: 19 of 22 tests passed.',
      changes: [
        {
          kind: 'M',
          path: 'inputs/run_arms.sh',
          note: 'The check failed, but on a crash, not a block.',
          contents: '#!/bin/bash\nset -e\nexit 70  # crash before the arm runs\n',
          baseline: '#!/bin/bash\nset -e\n',
        },
      ],
    },
  ],
};

export const [forged] = investigation.agent;
export const [planted] = forged.changes;

// CIT-376: the same walk, starting where an archive arrived in Proton Drive. The
// archive's restic repository lives on Drive; its snapshot holds every finding
// since last month's archive.
const archiveQuestion = 'Does release-2026-10 still keep the private file private?';
export const inDrive: Investigation = {
  drive: {
    folder: 'investigations',
    archives: [
      { name: 'release-2026-09.tar.gz', snapshot: '9f41c2d0', baseline: true },
      { name: 'release-2026-10.tar.gz', snapshot: '3c0f3a7e' },
    ],
  },
  vault: 'investigations',
  question: archiveQuestion,
  agent: [{
    tag: archiveQuestion,
    snapshot: '3c0f3a7e',
    evidence: 'Three findings: a forged read the check passed, a trace with the real read missing, and a crash.',
    changes: [...forged.changes, ...investigation.agent[1].changes],
  }],
};
