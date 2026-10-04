// CIT-253: regenerate artifact-bundle.json from the real captured files in this
// directory, byte for byte. Run `node build-artifact-bundle.mjs` after changing
// any of them; src/lib/evidenceArtifactResolver.spec.ts fails if the committed
// bundle drifts from the files, or from the artifact refs that
// src/lib/followerMazeReplay.ts emits.
//
// Identities mirror the producer (followerMazeReplay.ts): the vendored rule is
// pinned to the commit that added it to this repo (its bytes there are
// identical to the file here), and the wire transcript is addressed as the
// `ghost-trace-v1` capture. Nothing is abbreviated or shortened.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const recordingId = 'ghost-trace-v1';
const runId = 'arrival-4231';
const revision = 'be95c86ea1fddd8913cab7577f2405c1a2e90205';
const rulePath = 'tutorial-app/evidence/ghost-trace-v1/followerMaze.ts';
const transcriptPath = 'tutorial-app/evidence/ghost-trace-v1/wire-transcript.jsonl';
const rule = readFileSync(join(here, 'followerMaze.ts'), 'utf8');
const transcript = readFileSync(join(here, 'wire-transcript.jsonl'), 'utf8');

const artifact = (artifactId, frameId, path, identity, content, recordFormat) => ({
  artifactId, recordingId, runId, frameId, path, identity, ...(recordFormat ? { recordFormat } : {}), content,
});
const ruleIdentity = { kind: 'revision', revision };
const captureIdentity = { kind: 'capture', captureId: recordingId };

const bundle = {
  format: 'governance-evidence-bundle/v1',
  artifacts: [
    artifact('follower-maze-rule', 'failure', rulePath, ruleIdentity, rule),
    artifact('arrival-order-observation', 'failure', transcriptPath, captureIdentity, transcript, 'acp-wire-transcript'),
    artifact('follower-maze-rule', 'repair-pass', rulePath, ruleIdentity, rule),
    artifact('reorder-buffer-observation', 'repair-pass', transcriptPath, captureIdentity, transcript, 'acp-wire-transcript'),
  ],
};
writeFileSync(join(here, 'artifact-bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
