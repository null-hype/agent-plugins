import { describe, expect, it } from 'vitest';
import {
  BASE,
  CANDIDATE_A,
  CANDIDATE_B,
  CANDIDATE_B_REVISED,
  compose,
  evaluateFlows,
  merge3,
  simRevision,
} from './integrationScenario';
import { deriveView, replay } from './integrationSession';

describe('integration scenario: four cases through the real evaluator', () => {
  it('base passes', () => {
    expect(evaluateFlows(BASE.text).outcome).toBe('pass');
  });
  it('base + A passes', () => {
    expect(evaluateFlows(CANDIDATE_A.text).outcome).toBe('pass');
  });
  it('base + B passes', () => {
    expect(evaluateFlows(CANDIDATE_B.text).outcome).toBe('pass');
  });
  it('A + B merges textually clean but fails the rule, via the connecting flow', () => {
    const integration = compose(CANDIDATE_A, CANDIDATE_B);
    expect(integration.merge.ok).toBe(true);
    expect(integration.evaluation?.outcome).toBe('fail');
    const [v] = integration.evaluation!.violations;
    expect(v.class).toBe('pii');
    expect(v.path.map((s) => s.task)).toEqual([
      'export-customers',
      'export-customers',
      'sync-report',
      'sync-report',
    ]);
  });
  it('the repair (B revised) composes to a pass, with a new integration revision', () => {
    const before = compose(CANDIDATE_A, CANDIDATE_B);
    const after = compose(CANDIDATE_A, CANDIDATE_B_REVISED);
    expect(after.evaluation?.outcome).toBe('pass');
    expect(evaluateFlows(CANDIDATE_B_REVISED.text).outcome).toBe('pass');
    expect(after.revision).not.toBe(before.revision);
  });
  it('failure comes from the flow, not from both tasks being present', () => {
    // same two tasks, but B reads a path A never writes -> no flow, no failure
    const disconnected = CANDIDATE_A.text.replace('out/customers.csv', 'out/customers.txt');
    const merged = merge3(BASE.text, disconnected, CANDIDATE_B.text);
    expect(merged.ok && evaluateFlows(merged.text).outcome).toBe('pass');
  });
});

describe('merge3', () => {
  it('reports a textual conflict when both change the same place', () => {
    const other = CANDIDATE_A.text.replace('task export-customers', 'task other');
    const sameSpot = CANDIDATE_A.text.replace(/task export-customers.*/, 'task x reads=a writes=b');
    expect(merge3(BASE.text, CANDIDATE_A.text, sameSpot).ok).toBe(false);
    expect(other).not.toBe(CANDIDATE_A.text);
  });
  it('attributes each merged line to base, A or B', () => {
    const m = compose(CANDIDATE_A, CANDIDATE_B).merge;
    expect(m.ok && m.lines.filter((l) => l.origin === 'A').length).toBe(1);
    expect(m.ok && m.lines.filter((l) => l.origin === 'B').length).toBe(1);
  });
});

describe('session: staleness is derived from revisions', () => {
  it('starts pending; evaluating fails with a diagnostic naming both contributions', () => {
    expect(deriveView(replay()).status).toBe('pending');
    const v = deriveView(replay({ type: 'evaluate' }));
    expect(v.status).toBe('failed');
    expect(v.diagnostic?.comparison.path.map((s) => s.origin)).toContain('A');
    expect(v.diagnostic?.comparison.path.map((s) => s.origin)).toContain('B');
    expect(v.diagnostic?.diagnostic.related.every((r) => r.revision === v.integration.revision)).toBe(true);
  });
  it('applying the repair makes the prior evaluation stale, then re-evaluation passes', () => {
    const s1 = replay({ type: 'evaluate' }, { type: 'applyRepair' });
    expect(deriveView(s1).status).toBe('stale');
    expect(deriveView(s1).diagnostic).toBeNull();
    expect(deriveView(replay({ type: 'evaluate' }, { type: 'applyRepair' }, { type: 'evaluate' })).status).toBe('passed');
  });
  it('a pass is not approval; approval requires a current passing evaluation', () => {
    const passed = replay({ type: 'applyRepair' }, { type: 'evaluate' });
    expect(deriveView(passed).approval).toBe('none');
    expect(replay({ type: 'approve' }).approval).toBeNull();
    expect(replay({ type: 'evaluate' }, { type: 'approve' }).approval).toBeNull(); // failed check
    expect(deriveView(replay({ type: 'applyRepair' }, { type: 'evaluate' }, { type: 'approve' })).approval).toBe('granted');
  });
  it('changed inputs invalidate an existing approval', () => {
    // approval recorded against a revision that is no longer current
    const s = replay({ type: 'applyRepair' }, { type: 'evaluate' }, { type: 'approve' });
    const stale = { ...s, repairApplied: false };
    expect(deriveView(stale).approval).toBe('stale');
    expect(deriveView(stale).status).toBe('stale');
  });
  it('simRevision is deterministic and input-sensitive', () => {
    expect(simRevision('a', 'x')).toBe(simRevision('a', 'x'));
    expect(simRevision('a', 'x')).not.toBe(simRevision('a', 'y'));
  });
});
