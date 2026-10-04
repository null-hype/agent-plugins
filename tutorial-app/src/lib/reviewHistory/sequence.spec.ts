import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  deriveReplaySnapshot,
  validateReplayRecording,
  type EvidenceRef,
  type ReplayLocation,
  type ReplayRecording,
  type ReplaySelection,
  type ReplaySnapshot,
} from '../acpReplayContract';
import { assertAcpVerdict, deriveTraceView, metaOf, VERDICT_CHANNELS, type AcpFrame } from '../acpTraceProtocol';
import {
  BREAKPOINT_IDS,
  CAPTURES,
  FRAME_IDS,
  FRAME_ORDER,
  MERGE_COMMIT,
  PATHS,
  QUESTION_FRAMES,
  QUESTION_ORDER,
  RELATIONS,
  REVIEW_HISTORY_CAPABILITIES,
  REVIEW_HISTORY_DEFERRED,
  REVIEW_HISTORY_EVIDENCE_LABELS,
  REVIEW_HISTORY_MISSING_RECORDS,
  REVIEW_HISTORY_QUESTIONS,
  REVIEW_HISTORY_RECORDING_ID,
  REVIEW_HISTORY_RUN_ID,
  REVIEW_HISTORY_STEP_STATUS,
  REVISIONS,
  reviewHistoryRecording,
  type CheckerState,
  type FrameKey,
} from './index';

/**
 * CIT-306: the executable review-history sequence, at the level of data and
 * state. It exercises the recording through CIT-299's own `deriveReplaySnapshot`
 * (the canonical prefix derivation) and the existing `deriveTraceView`. It does
 * not implement stepping: the walk below only re-derives a snapshot per cursor,
 * and the controller that owns forward, back, seek and reset is CIT-300. What
 * this proves is that the recording gives that controller, and the shared
 * inspector, exactly the semantics the brief requires; browser acceptance is
 * `tests/review-history.acceptance.spec.ts`, which waits on CIT-301.
 */

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

// Frozen: any derivation that mutated the recording would throw (modules are strict).
const recording: ReplayRecording = deepFreeze(structuredClone(reviewHistoryRecording));
const pristine = structuredClone(reviewHistoryRecording);

const frameIds = recording.frames.map((f) => f.frameId);
const indexOfFrame = (id: string) => frameIds.indexOf(id);
const evaluationById = (localId: string) => {
  const found = recording.evaluations.find((e) => e.evaluationId === `${REVIEW_HISTORY_RUN_ID}:${localId}`);
  if (!found) throw new Error(`no evaluation ${localId}`);
  return found;
};
const id = (localId: string) => `${REVIEW_HISTORY_RUN_ID}:${localId}`;

const at = (frame: string, selection: ReplaySelection = null, viewport: ReplayLocation['viewport'] = {}): ReplayLocation => ({
  recordingId: recording.recordingId, runId: recording.runId, cursor: { kind: 'frame', frameId: frame }, selection, viewport,
});
const atKey = (key: FrameKey, selection: ReplaySelection = null, viewport: ReplayLocation['viewport'] = {}) => at(FRAME_IDS[key], selection, viewport);
const beforeFirst: ReplayLocation = { recordingId: recording.recordingId, runId: recording.runId, cursor: { kind: 'before-first' }, selection: null, viewport: {} };

const derive = (location: ReplayLocation, source: ReplayRecording = recording): ReplaySnapshot => {
  const result = deriveReplaySnapshot(source, location);
  if (!('location' in result)) throw new Error(`unexpected failure ${JSON.stringify(result)}`);
  return result;
};
const evidenceIdsOf = (snapshot: ReplaySnapshot) => snapshot.availableEvidence.map((e) => e.evidenceId);
const evaluationIdsOf = (snapshot: ReplaySnapshot) => snapshot.evaluations.map((e) => e.evaluationId);
const allEvidence = (): EvidenceRef[] => recording.evaluations.flatMap((e) => [...e.evidence]);

describe('review history: the recording', () => {
  it('is a valid CIT-299 recording with stable identities and one frame per recorded checkpoint, in order', () => {
    expect(validateReplayRecording(recording)).toBeNull();
    expect(recording.recordingId).toBe('cit-294-review-history-v1');
    expect(recording.runId).toBe('cit-294-117-118-120');
    expect(frameIds).toEqual(FRAME_ORDER.map((key) => FRAME_IDS[key]));
    expect(recording.frames.map((f) => f.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('has four checker states and three review/fix cycles', () => {
    const revisions = new Set(allEvidence().flatMap((e) => (e.availability.status === 'captured' && e.availability.artifact.identity.kind === 'revision' ? [e.availability.artifact.identity.revision] : [])));
    expect([...revisions].sort()).toEqual((['S1', 'S2', 'S3', 'S4'] as CheckerState[]).map((s) => REVISIONS[s].pinned).sort());
    // Question, then result; then (review, correction) three times; then the merge.
    expect(recording.frames.map((f) => f.actor)).toEqual(['client', 'agent', 'client', 'agent', 'client', 'agent', 'client', 'agent', 'agent']);
    const cycles = [['r1', 's2'], ['r2', 's3'], ['r3', 's4']] as const;
    for (const [review, fix] of cycles) expect(indexOfFrame(FRAME_IDS[fix])).toBe(indexOfFrame(FRAME_IDS[review]) + 1);
    expect(recording.frames.filter((f) => f.actor === 'client').map((f) => f.speaker)).toEqual(['CIT-294 issue', 'reviewer', 'reviewer', 'reviewer']);
  });

  it('gives each question a stable identity: the frame that poses it', () => {
    expect(QUESTION_ORDER).toEqual(['Q0', 'Q1', 'Q2', 'Q3']);
    expect(QUESTION_ORDER.map((q) => QUESTION_FRAMES[q])).toEqual(['q0', 'r1', 'r2', 'r3']);
    for (const q of QUESTION_ORDER) {
      const frame = recording.frames[indexOfFrame(FRAME_IDS[QUESTION_FRAMES[q]])];
      expect(frame.actor).toBe('client');
      expect(metaOf(frame.envelope)?.pins?.map((p) => p.id)).toContain(REVIEW_HISTORY_QUESTIONS[q].pin);
    }
  });

  it('gives each breakpoint to exactly one frame', () => {
    const owners = new Map<string, string[]>();
    for (const f of recording.frames) for (const bp of f.breakpointIds ?? []) owners.set(bp, [...(owners.get(bp) ?? []), f.frameId]);
    expect([...owners.keys()].sort()).toEqual(Object.values(BREAKPOINT_IDS).sort());
    for (const frames of owners.values()) expect(frames).toHaveLength(1);
  });

  it('is plain JSON: both hosts can load the same value', () => {
    expect(JSON.parse(JSON.stringify(recording))).toEqual(recording);
  });

  it('uses only verdict channels and statuses the existing contract defines', () => {
    for (const f of recording.frames) {
      const verdict = metaOf(f.envelope)?.verdict;
      if (verdict) expect(() => assertAcpVerdict(verdict)).not.toThrow();
    }
    for (const e of recording.evaluations) {
      for (const { channel, value } of e.verdicts) {
        expect(VERDICT_CHANNELS).toContain(channel);
        expect(() => assertAcpVerdict({ channel, status: value, text: 'x' })).not.toThrow();
      }
    }
  });

  it('does not present navigation as something an agent did, nor invent a wire exchange', () => {
    for (const f of recording.frames) {
      expect(`${f.speaker} ${f.action}`, f.frameId).not.toMatch(/\b(select|open|step|seek|reset|inspect|navigate|continue|rewind|replay)\b/i);
      expect(f.envelope.method, f.frameId).toBeUndefined();
    }
  });
});

describe('review history: state at every cursor', () => {
  it.each(FRAME_ORDER.map((key, index) => [key, index] as const))('at %s the state is exactly the recorded prefix', (key, index) => {
    const snapshot = derive(atKey(key));
    expect(snapshot.frames).toEqual(recording.frames.slice(0, index + 1));
    const expectedEvaluations = recording.evaluations.filter((e) => indexOfFrame(e.frameId) <= index);
    expect(evaluationIdsOf(snapshot)).toEqual(expectedEvaluations.map((e) => e.evaluationId));
    for (const evaluation of snapshot.evaluations) {
      for (const evidence of evaluation.evidence) expect(indexOfFrame(evidence.availableAt)).toBeLessThanOrEqual(index);
    }
    expect(evidenceIdsOf(snapshot)).toEqual(
      expectedEvaluations.flatMap((e) => e.evidence.filter((ev) => indexOfFrame(ev.availableAt) <= index).map((ev) => ev.evidenceId)),
    );
  });

  it.each(FRAME_ORDER.map((key, index) => [key, index] as const))('at %s nothing from a later frame is reachable anywhere in the snapshot', (key, index) => {
    const snapshot = JSON.stringify(derive(atKey(key)));
    const later = new Set<string>();
    for (const f of recording.frames.slice(index + 1)) {
      later.add(f.frameId);
      for (const bp of f.breakpointIds ?? []) later.add(bp);
      for (const pin of metaOf(f.envelope)?.pins ?? []) later.add(pin.id);
    }
    for (const e of recording.evaluations) {
      if (indexOfFrame(e.frameId) > index) later.add(e.evaluationId);
      for (const ev of e.evidence) {
        if (indexOfFrame(ev.availableAt) <= index) continue;
        later.add(ev.evidenceId);
        if (ev.availability.status === 'captured') later.add(ev.availability.artifact.artifactId);
      }
    }
    for (const state of ['S1', 'S2', 'S3', 'S4'] as CheckerState[]) {
      if (indexOfFrame(FRAME_IDS[REVISIONS[state].frame]) <= index) continue;
      for (const sha of [REVISIONS[state].pinned, REVISIONS[state].mergedEquivalent]) {
        if (!sha) continue;
        later.add(sha);
        // Review 3 names the commit whose message is its only surviving account, labelled second-hand.
        if (!(key === 'r3' && sha === REVISIONS.S4.pinned)) later.add(sha.slice(0, 7));
      }
    }
    if (index < indexOfFrame(FRAME_IDS.landed)) later.add(MERGE_COMMIT);
    // The second-hand label at r3 is the one documented place a later revision is named.
    if (key === 'r3') later.delete(REVISIONS.S4.pinned);
    for (const token of later) expect(snapshot, `"${token}" leaked into the snapshot at ${key}`).not.toContain(token);
  });

  it('keeps pins accumulating through the existing trace view, and accepts every prefix', () => {
    const expected = ['q0'];
    const seen: string[][] = [];
    for (const key of FRAME_ORDER) {
      const frames = derive(atKey(key)).frames as unknown as AcpFrame[];
      seen.push(deriveTraceView(frames).pins.map((p) => p.id));
    }
    expect(seen[0]).toEqual(expected);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i].slice(0, seen[i - 1].length)).toEqual(seen[i - 1]);
    expect(seen.at(-1)).toEqual(['q0', 'rev-s1', 'q1', 'rev-s2', 'q2', 'rev-s3', 'q3', 'rev-s4', 'rev-s5']);
  });

  it('never drops an earlier claim, finding or assessment: each stays, unchanged, at every later cursor', () => {
    for (let later = 1; later < FRAME_ORDER.length; later += 1) {
      const now = derive(atKey(FRAME_ORDER[later]));
      for (let earlier = 0; earlier < later; earlier += 1) {
        const before = derive(atKey(FRAME_ORDER[earlier]));
        for (const evaluation of before.evaluations) {
          const kept = now.evaluations.find((e) => e.evaluationId === evaluation.evaluationId);
          expect(kept, `${evaluation.evaluationId} dropped by ${FRAME_ORDER[later]}`).toBeDefined();
          expect(kept?.diagnostic).toEqual(evaluation.diagnostic);
          expect(kept?.verdicts).toEqual(evaluation.verdicts);
          expect(kept?.provenance).toEqual(evaluation.provenance);
          // Evidence only ever grows: what answers a finding is added beside it.
          const keptIds = new Set(kept?.evidence.map((ev) => ev.evidenceId));
          for (const ev of evaluation.evidence) expect(keptIds.has(ev.evidenceId)).toBe(true);
        }
      }
    }
  });

  it('shows what answers a finding only once the correction is reached, beside the finding it answers', () => {
    const finding = 'review-1.finding-1';
    const answers = (key: FrameKey) =>
      derive(atKey(key)).evaluations.find((e) => e.evaluationId === id(finding))?.evidence.map((e) => e.evidenceId.split('/')[1]) ?? [];
    expect(answers('r1')).toEqual(['review-text', 'cited-source', 'mutation-output']);
    expect(answers('s2')).toEqual(expect.arrayContaining(['review-text', 's2.collector', 's2.checker', 's2.control-deleted-trace']));
    expect(answers('landed')).toEqual(answers('s2'));
  });
});

describe('review history: reviewer findings are recorded review evidence, not detector flags', () => {
  const findings = recording.evaluations.filter((e) => /^cit-294-117-118-120:review-/.test(e.evaluationId));

  it('puts every finding in the review channel with recorded provenance and the review’s own capture', () => {
    // Review 1: four findings. Review 2: three gaps and one reassessment. Review 3: two findings.
    expect(findings).toHaveLength(10);
    const captureIds: Record<string, string> = { 'review-1': CAPTURES.review1.captureId, 'review-2': CAPTURES.review2.captureId };
    for (const finding of findings) {
      expect(finding.verdicts.map((v) => v.channel)).toEqual(['review']);
      expect(finding.provenance.kind).toBe('recorded');
      const captureId = finding.provenance.kind === 'recorded' ? finding.provenance.captureId : '';
      const review = finding.evaluationId.split(':')[1].split('.')[0];
      if (review === 'review-3') expect(captureId).toMatch(/^secondary-account:/);
      else expect(captureId).toBe(captureIds[review]);
    }
  });

  it('never derives a finding from the retained detector output, and never reuses a detector flag code', () => {
    const flagKinds = new Set<string>();
    for (const state of ['S1', 'S2', 'S3', 'S4'] as CheckerState[]) {
      const bundle = fileURLToPath(new URL('../../../evidence/cit-294-review-history-v1/', import.meta.url));
      const entry = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')).files.find((f: { revision: string; path: string }) => f.revision === REVISIONS[state].pinned && f.path === PATHS.reconcile);
      for (const m of readFileSync(join(bundle, entry.file), 'utf8').matchAll(/flag\("([a-z-]+)"/g)) flagKinds.add(m[1]);
    }
    expect(flagKinds.size).toBeGreaterThan(10);
    for (const e of recording.evaluations) {
      expect(flagKinds.has(e.diagnostic.code), e.diagnostic.code).toBe(false);
      expect(e.provenance.kind === 'recorded' ? e.provenance.captureId : '').not.toMatch(/diagnostics/);
    }
  });

  it('keeps the claim, the finding and the reassessment on different footing: only a reviewer ever approves, and only once', () => {
    const approved = recording.evaluations.filter((e) => e.verdicts.some((v) => v.value === 'approved'));
    expect(approved.map((e) => e.evaluationId)).toEqual([id('review-2.reassessed.findings-2-3')]);
    for (const claim of ['s1.claim', 's2.claim', 's3.claim', 's4.claim']) {
      expect(evaluationById(claim).verdicts).toEqual([{ channel: 'review', value: 'pending' }]);
      expect(evaluationById(claim).diagnostic.severity).toBe('info');
    }
    for (const finding of findings.filter((f) => f.diagnostic.severity === 'error')) expect(finding.verdicts).toEqual([{ channel: 'review', value: 'flagged' }]);
  });

  it('records no review of the last change and no approval of any later fix', () => {
    expect(FRAME_ORDER.slice(FRAME_ORDER.indexOf('s4'))).toEqual(['s4', 'landed']);
    expect(evaluationById('landed.history').diagnostic.message).toMatch(/No review of the final revision, cc23e89, is recorded\./);
    expect(evaluationById('s4.claim').verdicts).toEqual([{ channel: 'review', value: 'pending' }]);
  });
});

describe('review history: the disagreement and the changed conclusion stay inspectable', () => {
  it('relates each later evaluation to an earlier one that exists, never the other way round', () => {
    expect(RELATIONS.length).toBeGreaterThanOrEqual(7);
    for (const r of RELATIONS) {
      expect(indexOfFrame(evaluationById(r.to).frameId), `${r.from} -> ${r.to}`).toBeLessThan(indexOfFrame(evaluationById(r.from).frameId));
      // A relation is visible exactly when its later end is: the earlier end is always in the prefix by then.
      const snapshot = derive(at(evaluationById(r.from).frameId));
      expect(evaluationIdsOf(snapshot)).toEqual(expect.arrayContaining([id(r.from), id(r.to)]));
      expect(r.quote.length).toBeGreaterThan(10);
    }
    expect(RELATIONS.filter((r) => r.basis === 'inferred').map((r) => `${r.from}->${r.to}`)).toEqual([
      'review-2.gap-2->review-1.finding-1', 'review-3.finding-1->review-2.gap-1',
    ]);
  });

  it('puts each claim beside the review that contradicts it, and leaves the last claim unanswered', () => {
    const flaggedAfter = (claimFrame: FrameKey, reviewFrame: FrameKey) => {
      const claim = derive(atKey(reviewFrame)).evaluations.find((e) => e.frameId === FRAME_IDS[claimFrame] && /claim/.test(e.evaluationId));
      const findings = derive(atKey(reviewFrame)).evaluations.filter((e) => e.frameId === FRAME_IDS[reviewFrame] && e.verdicts.some((v) => v.value === 'flagged'));
      return { claim: claim?.diagnostic.message ?? '', findings: findings.length };
    };
    expect(flaggedAfter('s1', 'r1')).toMatchObject({ findings: 4 });
    expect(flaggedAfter('s2', 'r2').claim).toContain("Each of the review's 5 exact mutations");
    expect(flaggedAfter('s2', 'r2').findings).toBe(3);
    expect(flaggedAfter('s3', 'r3').claim).toContain("it wasn't before");
    expect(flaggedAfter('s3', 'r3').findings).toBe(2);
    expect(FRAME_ORDER.indexOf('landed')).toBe(FRAME_ORDER.indexOf('s4') + 1);
  });

  it('shows the S2 fact that claimed to be the exact finding beside the S3 relabelling of the same slot', () => {
    const gap = derive(atKey('s3')).evaluations.find((e) => e.evaluationId === id('review-2.gap-1'));
    const ids = gap?.evidence.map((e) => e.evidenceId.split('/')[1]) ?? [];
    expect(ids).toEqual(expect.arrayContaining(['cited-source', 's3.control-count-zeroed', 's3.control-count-inflated', 's3.control-deleted-trace', 's3.control-forged-trace']));
  });
});

describe('review history: stepping, seeking, selecting, resetting', () => {
  // Direct seeks, taken once from a clean copy: the reference every walk must reproduce.
  const direct = new Map(FRAME_ORDER.map((key) => [key, derive(atKey(key), structuredClone(pristine))] as const));

  it('reproduces direct seeks along a forward, backward, forward walk and a seeded random walk', () => {
    const path: FrameKey[] = [...FRAME_ORDER, ...[...FRAME_ORDER].reverse(), ...FRAME_ORDER];
    let seed = 306;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 200; i += 1) path.push(FRAME_ORDER[Math.floor(next() * FRAME_ORDER.length)]);
    for (const key of path) expect(derive(atKey(key)), `after reaching ${key}`).toEqual(direct.get(key));
    expect(recording).toEqual(pristine);
  });

  it('removes later evidence and assessments when stepping back and restores exactly the same state when stepping forward', () => {
    for (let k = 1; k < FRAME_ORDER.length; k += 1) {
      const back = derive(atKey(FRAME_ORDER[k - 1]));
      const here = derive(atKey(FRAME_ORDER[k]));
      const gone = evaluationIdsOf(here).filter((e) => !evaluationIdsOf(back).includes(e));
      expect(gone.every((e) => indexOfFrame(evaluationById(e.split(':')[1]).frameId) === k)).toBe(true);
      expect(evidenceIdsOf(back).every((e) => evidenceIdsOf(here).includes(e))).toBe(true);
      expect(derive(atKey(FRAME_ORDER[k]))).toEqual(here);
    }
    // The finding and its answer: back at r1 the answer is gone, the finding and the claim it contradicts stay.
    const atS2 = derive(atKey('s2', { kind: 'evidence', evidenceId: 'review-1.finding-1/s2.checker' }));
    expect(atS2.selection).toEqual({ kind: 'evidence', evidenceId: 'review-1.finding-1/s2.checker' });
    const backAtR1 = derive({ ...atS2.location, cursor: { kind: 'frame', frameId: FRAME_IDS.r1 } });
    expect(backAtR1.selection).toBeNull();
    expect(backAtR1.selectionFailure).toMatchObject({ status: 'selection-not-in-prefix' });
    expect(evaluationIdsOf(backAtR1)).toEqual(expect.arrayContaining([id('s1.claim'), id('review-1.finding-1')]));
  });

  it('keeps a still-valid selection when stepping back, and clears only one that is no longer in the prefix', () => {
    const selected = derive(atKey('s2', { kind: 'evaluation', evaluationId: id('review-1.finding-1') }));
    const back = derive({ ...selected.location, cursor: { kind: 'frame', frameId: FRAME_IDS.r1 } });
    expect(back.selection).toEqual({ kind: 'evaluation', evaluationId: id('review-1.finding-1') });
    expect(back.selectionFailure).toBeUndefined();
    const earlier = derive({ ...selected.location, cursor: { kind: 'frame', frameId: FRAME_IDS.s1 } });
    expect(earlier.selection).toBeNull();
    expect(earlier.selectionFailure).toMatchObject({ status: 'selection-not-in-prefix' });
  });

  it('never moves playback when something is selected: every question, evaluation and evidence item, at every cursor where it exists', () => {
    for (const [index, key] of FRAME_ORDER.entries()) {
      const snapshot = derive(atKey(key));
      const selections: ReplaySelection[] = [
        ...snapshot.frames.map((f) => ({ kind: 'frame' as const, frameId: f.frameId })),
        ...QUESTION_ORDER.filter((q) => indexOfFrame(FRAME_IDS[QUESTION_FRAMES[q]]) <= index).map((q) => ({ kind: 'question' as const, frameId: FRAME_IDS[QUESTION_FRAMES[q]] })),
        ...snapshot.evaluations.map((e) => ({ kind: 'evaluation' as const, evaluationId: e.evaluationId })),
        ...snapshot.availableEvidence.map((e) => ({ kind: 'evidence' as const, evidenceId: e.evidenceId })),
      ];
      expect(selections.length).toBeGreaterThan(0);
      for (const selection of selections) {
        const selected = derive(atKey(key, selection));
        expect(selected.location.cursor).toEqual({ kind: 'frame', frameId: FRAME_IDS[key] });
        expect(selected.selection).toEqual(selection);
        expect(selected.selectionFailure).toBeUndefined();
        expect(selected.frames).toEqual(snapshot.frames);
      }
    }
  });

  it('refuses a selection that is not in the prefix, explicitly, and reopens without it', () => {
    const later: ReplaySelection[] = [
      { kind: 'evaluation', evaluationId: id('review-2.gap-1') },
      { kind: 'evidence', evidenceId: 'review-1.finding-1/s2.collector' },
      { kind: 'question', frameId: FRAME_IDS.r3 },
      { kind: 'frame', frameId: FRAME_IDS.landed },
    ];
    for (const selection of later) {
      const result = derive(atKey('r1', selection));
      expect(result.selection).toBeNull();
      expect(result.location.selection).toBeNull();
      expect(result.selectionFailure).toEqual({ status: 'selection-not-in-prefix', selection });
      const reopened = derive(structuredClone(result.location));
      expect(reopened.selectionFailure).toBeUndefined();
      expect(reopened.frames).toEqual(result.frames);
    }
  });

  it('keeps the log viewport independent of cursor, selection and what is shown', () => {
    const plain = derive(atKey('r2', { kind: 'evaluation', evaluationId: id('review-2.gap-1') }));
    const scrolled = derive(atKey('r2', { kind: 'evaluation', evaluationId: id('review-2.gap-1') }, { anchorFrameId: FRAME_IDS.q0, filter: 'review' }));
    expect(scrolled.frames).toEqual(plain.frames);
    expect(scrolled.evaluations).toEqual(plain.evaluations);
    expect(scrolled.selection).toEqual(plain.selection);
    expect(scrolled.location.viewport).toEqual({ anchorFrameId: FRAME_IDS.q0, filter: 'review' });
  });

  it('resets to before the first frame with nothing shown, and reopens the same pinned location from its serialized form', () => {
    const reset = derive(beforeFirst);
    expect(reset).toMatchObject({ frames: [], evaluations: [], availableEvidence: [], selection: null });
    for (const key of FRAME_ORDER) {
      const selection: ReplaySelection = { kind: 'question', frameId: FRAME_IDS[key] };
      const opened = derive(atKey(key, selection, { anchorFrameId: FRAME_IDS.q0 }));
      const reopened = derive(JSON.parse(JSON.stringify(opened.location)));
      expect(reopened).toEqual(opened);
      expect(reopened.location).toMatchObject({ recordingId: REVIEW_HISTORY_RECORDING_ID, runId: REVIEW_HISTORY_RUN_ID, cursor: { frameId: FRAME_IDS[key] } });
    }
    for (const [breakpoint, key] of Object.entries(BREAKPOINT_IDS).map(([k, v]) => [v, k as FrameKey] as const)) {
      const frame = recording.frames.find((f) => f.breakpointIds?.includes(breakpoint));
      expect(frame?.frameId, breakpoint).toBe(FRAME_IDS[key]);
    }
  });

  it('answers an invalid or unavailable reference with an explicit outcome, never a fallback to another recording', () => {
    expect(deriveReplaySnapshot(recording, at('no-such-frame'))).toEqual({ status: 'frame-not-found', frameId: 'no-such-frame' });
    expect(deriveReplaySnapshot(recording, { ...atKey('r1'), recordingId: 'ghost-trace-v1' })).toMatchObject({ status: 'recording-not-found', recordingId: 'ghost-trace-v1' });
    expect(deriveReplaySnapshot(recording, { ...atKey('r1'), runId: 'arrival-4231' })).toMatchObject({ status: 'recording-not-found', runId: 'arrival-4231' });
    // An artifact that was never captured is an explicit state of the evidence, with its reason, not a hole.
    const missing = allEvidence().filter((e) => e.availability.status === 'missing');
    expect(missing).toHaveLength(14);
    for (const e of missing) expect(e.availability.status === 'missing' && e.availability.reason.length).toBeGreaterThan(40);
    const tampered = structuredClone(pristine);
    const captured = tampered.evaluations[1].evidence.find((e) => e.availability.status === 'captured');
    if (captured?.availability.status === 'captured') captured.availability.artifact.recordingId = 'other';
    expect(validateReplayRecording(tampered)).toMatchObject({ status: 'invalid-recording' });
  });
});

describe('review history: absence is shown as absence', () => {
  const evidenceById = new Map(allEvidence().map((e) => [e.evidenceId, e] as const));

  it('accounts for every missing item in a named missing record, and every named record that is shown', () => {
    const named = new Set(REVIEW_HISTORY_MISSING_RECORDS.flatMap((m) => m.evidenceIds));
    for (const evidenceId of named) {
      const evidence = evidenceById.get(evidenceId);
      expect(evidence, evidenceId).toBeDefined();
      expect(evidence?.availability.status, evidenceId).toBe('missing');
    }
    for (const [evidenceId, evidence] of evidenceById) {
      if (evidence.availability.status === 'missing') expect(named.has(evidenceId), `${evidenceId} is missing but unnamed`).toBe(true);
    }
    expect(REVIEW_HISTORY_MISSING_RECORDS.map((m) => m.id)).toEqual(expect.arrayContaining([
      'sealed-declaration', 'proton-pass-observation', 'review-3-original-text', 'original-mutation-output', 'check-result-at-s1', 'review-of-final-revision', 'pre-rewrite-s3-s4',
    ]));
  });

  it('labels Q0 as historical issue text that was never sealed, and invents no registration or Proton Pass record', () => {
    const q0 = metaOf(recording.frames[0].envelope)?.pins?.[0];
    expect(q0?.label).toMatch(/historical issue text/);
    expect(q0?.label).toMatch(/not a sealed declaration/);
    expect(q0?.label).toMatch(/nothing was registered before this run/);
    const json = JSON.stringify(recording);
    expect(json).not.toMatch(/PROTON_PASS/);
    expect(json.match(/sealed/gi)?.length ?? 0).toBe((q0?.label.match(/sealed/gi) ?? []).length);
    // Q0 has no registration, no verdict and no evaluation: it is the question, not an assessment.
    expect(metaOf(recording.frames[0].envelope)?.verdict).toBeUndefined();
    expect(recording.evaluations.filter((e) => e.frameId === FRAME_IDS.q0)).toEqual([]);
  });

  it('shows review 3 as unretrievable, with the second-hand account offered only once its source exists', () => {
    const atR3 = derive(atKey('r3'));
    const atS4 = derive(atKey('s4'));
    expect(evidenceIdsOf(atR3).filter((e) => /secondary-account/.test(e))).toEqual([]);
    expect(evidenceIdsOf(atS4).filter((e) => /secondary-account/.test(e))).not.toEqual([]);
    for (const finding of ['review-3.finding-1', 'review-3.finding-2']) {
      const original = evidenceById.get(`${finding}/original-text`);
      expect(original).toMatchObject({ contentKind: 'recorded-review-prose', availability: { status: 'missing' } });
      expect(evaluationById(finding).diagnostic.code).toMatch(/second-hand$/);
    }
    expect(metaOf(recording.frames[indexOfFrame(FRAME_IDS.r3)].envelope)?.pins?.[0].label).toMatch(/second-hand account.*could not be retrieved/);
  });
});

describe('review history: input, monitor and diagnostic stay distinct', () => {
  it('keeps questions on the requesting side, revisions on the answering side, and verdicts only on evaluations', () => {
    for (const f of recording.frames) {
      const ids = (metaOf(f.envelope)?.pins ?? []).map((p) => p.id);
      for (const pin of ids) expect(f.actor === 'client' ? /^q[0-3]$/.test(pin) : /^rev-s[1-5]$/.test(pin), `${f.frameId} ${pin}`).toBe(true);
    }
    for (const evidence of allEvidence()) expect(evidence).not.toHaveProperty('verdicts');
  });

  it('uses the existing location roles consistently: facts are declared, observations are monitored, axioms are the checker', () => {
    const checker = /(Reconcile\.pkl|cit294\.test\.pkl|Observation\.pkl)$/;
    const monitored = /(observations\/|run_arms\.sh|canary-reads\.txt)/;
    for (const e of recording.evaluations) {
      for (const location of [e.diagnostic.subject, ...e.diagnostic.related]) {
        if (location.role === 'axiom') expect(location.uri, `${e.evaluationId}: ${location.detail}`).toMatch(checker);
        if (location.role === 'observation') expect(location.uri, `${e.evaluationId}: ${location.detail}`).toMatch(monitored);
        if (location.role === 'fact') expect(location.uri, `${e.evaluationId}: ${location.detail}`).not.toMatch(checker);
      }
    }
  });

  it('shows the monitor without a verdict: observation and trace evidence is captured output, never prose or a judgement', () => {
    const monitor = allEvidence().filter((e) => /\/(obs-|trace$)/.test(e.evidenceId));
    expect(monitor.length).toBe(20);
    for (const e of monitor) {
      expect(e.contentKind).toBe('captured-execution-output');
      expect(e.role).toBe('related');
    }
  });
});

describe('review history: labels', () => {
  it('labels every step on both axes, separately, and never calls a step working before the shared inspector exists', () => {
    expect(Object.keys(REVIEW_HISTORY_STEP_STATUS)).toEqual(FRAME_ORDER);
    expect(FRAME_ORDER.map((k) => REVIEW_HISTORY_STEP_STATUS[k].row)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9']);
    const inspector = REVIEW_HISTORY_CAPABILITIES.find((c) => c.id === 'shared-inspector');
    for (const key of FRAME_ORDER) {
      const status = REVIEW_HISTORY_STEP_STATUS[key];
      expect(status.evidence.length, key).toBeGreaterThan(0);
      expect(status.note.length, key).toBeGreaterThan(10);
      if (inspector?.status !== 'working') expect(status.implementation, `${key} claims working before the inspector exists`).not.toBe('working');
    }
    // Working and recorded are compatible labels: nothing forces one to imply the other.
    expect(REVIEW_HISTORY_STEP_STATUS.r3).toMatchObject({ secondHand: true });
  });

  it('names the missing shared capabilities against their owning issues, and the deferred behaviours against theirs', () => {
    const missing = REVIEW_HISTORY_CAPABILITIES.filter((c) => c.required && c.status === 'missing');
    expect(missing.map((c) => [c.id, c.owner.split(' ')[0]])).toEqual([
      ['playback-controls', 'CIT-300'], ['artifact-resolution', 'CIT-253'], ['shared-inspector', 'CIT-301'], ['revision-compare', 'CIT-301'],
    ]);
    expect(REVIEW_HISTORY_CAPABILITIES.filter((c) => c.status === 'working').map((c) => c.id)).toEqual(['recording-derivation', 'pinned-evidence-bundle']);
    expect(REVIEW_HISTORY_DEFERRED.map((d) => [d.row, d.owner])).toEqual([['T12', 'CIT-304'], ['T13', 'CIT-304'], ['T14', 'CIT-304'], ['T15', 'CIT-304'], ['—', 'CIT-233']]);
  });

  it('gives every evidence item a label that names only what exists at that point', () => {
    const stateAt: Record<FrameKey, number> = { q0: 0, s1: 1, r1: 1, s2: 2, r2: 2, s3: 3, r3: 3, s4: 4, landed: 4 };
    for (const evidence of allEvidence()) {
      const label = REVIEW_HISTORY_EVIDENCE_LABELS[evidence.evidenceId];
      expect(label, evidence.evidenceId).toBeTruthy();
      const key = (Object.entries(FRAME_IDS).find(([, v]) => v === evidence.availableAt)?.[0] ?? 'q0') as FrameKey;
      for (const m of label.matchAll(/\bS([1-4])\b/g)) expect(Number(m[1]), `${evidence.evidenceId}: ${label}`).toBeLessThanOrEqual(stateAt[key]);
    }
  });
});

/**
 * A plain-text projection of a snapshot, built from the recording alone: no
 * lesson prose, no host. It exists only in this spec, as a check that the
 * recording carries enough to follow the sequence with the explanatory prose
 * hidden. It is not a renderer and is not exported.
 */
const transcript = (snapshot: ReplaySnapshot): string => {
  const lines: string[] = [];
  const pins = deriveTraceView(snapshot.frames as unknown as AcpFrame[]).pins;
  for (const frame of snapshot.frames) {
    lines.push(`[${frame.frameId}] ${frame.speaker} (${frame.actor}): ${frame.action}`);
    for (const pin of pins.filter((p) => (metaOf(frame.envelope)?.pins ?? []).some((q) => q.id === p.id))) lines.push(`  pin ${pin.label}`, ...pin.text.split('\n').map((l) => `    ${l}`));
    const verdict = metaOf(frame.envelope)?.verdict;
    if (verdict) lines.push(`  review ${verdict.status}: ${verdict.text}`);
    for (const evaluation of snapshot.evaluations.filter((e) => e.frameId === frame.frameId)) {
      lines.push(`  ${evaluation.diagnostic.code} [${evaluation.verdicts.map((v) => `${v.channel}:${v.value}`).join(' ') || 'no verdict'}] ${evaluation.diagnostic.message}`);
      for (const evidence of evaluation.evidence) {
        const label = REVIEW_HISTORY_EVIDENCE_LABELS[evidence.evidenceId];
        lines.push(`    - ${evidence.contentKind} · ${label}${evidence.availability.status === 'missing' ? ` :: ${evidence.availability.reason}` : ''}`);
      }
    }
  }
  return lines.join('\n');
};

describe('review history: understandable with the explanatory prose hidden', () => {
  const at$ = (key: FrameKey) => transcript(derive(atKey(key)));

  it('shows the selected question, its status and its recorded criteria before any result', () => {
    const text = at$('q0');
    expect(text).toContain('historical issue text');
    expect(text).toContain('not a sealed declaration');
    expect(text).toContain('A generic crash alone is insufficient.');
    expect(text).not.toMatch(/review-1|S1 ·|claimed-result/);
  });

  it('shows the claimed result, then the review that disagrees, each finding in the reviewer’s words with its source and what was not captured', () => {
    const text = at$('r1');
    expect(text).toContain('The concrete remaining impact proof CIT-265 named is done');
    for (const finding of ['The independent file-read evidence never reaches the checker.', 'A generic variant crash passes as successful blocking.', 'Byte recovery is trusted through a boolean.', 'The tutorial/report acceptance step is missing.']) expect(text).toContain(finding);
    expect(text).toContain('recorded-review-prose · Review 1, finding 1 (recorded review text)');
    expect(text).toContain('Original mutation output — not captured');
    expect(text).toContain('Retained authoritative check result and detector output — not captured');
    expect(text).not.toMatch(/S2 change|review-2/);
  });

  it('shows the correction beside the finding it answers while keeping the earlier claim and finding', () => {
    const text = at$('s2');
    expect(text).toContain('S2 change: independent evidence derived outside the Ruby process');
    expect(text).toContain('review-1.finding-1 [review:flagged] The independent file-read evidence never reaches the checker.');
    expect(text).toContain('s1.claimed-result');
    expect(text).toContain("Each of the review's 5 exact mutations");
    expect(text).not.toMatch(/review-2\.gap|S3 change/);
  });

  it('shows the changed conclusion: two findings reassessed as fixed, three gaps, and the claim called inaccurate', () => {
    const text = at$('r2');
    expect(text).toContain('review-2.reassessed.findings-2-3 [review:approved] The byte-validation and generic-crash findings are fixed.');
    expect(text).toContain('The trace negative controls mutate the derived count, not the retained trace.');
    expect(text).toContain("The PR's claim that all five exact mutations are fixed is therefore inaccurate.");
    expect(text).toContain('Review 1, finding 1 (recorded review text)');
    expect(text).not.toMatch(/review-3|S3 change/);
  });

  it('shows review 3 as second-hand, with the account itself only after the correction that carries it', () => {
    const atReview = at$('r3');
    expect(atReview).toContain('second-hand account: the original review text could not be retrieved');
    expect(atReview).toContain('Review 3, original text — not captured');
    expect(atReview).not.toContain('Second-hand account of review 3');
    expect(at$('s4')).toContain('Second-hand account of review 3: the cc23e89 commit message');
  });

  it('ends at a merge, with all four questions still visible and an explicit statement that the final revision was not reviewed', () => {
    const text = at$('landed');
    for (const q of QUESTION_ORDER) expect(text).toContain(REVIEW_HISTORY_QUESTIONS[q].label);
    expect(text).toContain('No review of the final revision, cc23e89, is recorded.');
    expect(text).toContain('A review of the final revision — not captured');
    expect(text.split('\n').filter((l) => /^\[/.test(l))).toHaveLength(9);
  });
});
