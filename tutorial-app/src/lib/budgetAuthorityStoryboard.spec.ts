import { describe, expect, it } from 'vitest';
import { deriveTraceView, metaOf } from './acpTraceProtocol';
import {
  LIMIT_V1,
  LIMIT_V2,
  PROPOSAL_LINES,
  QUESTION,
  buildBudgetAuthorityLessons,
  evaluateBudget,
} from './budgetAuthorityStoryboard';

const merge = { tree: '0123456789abcdef0123456789abcdef01234567', conflicts: 0 };

describe('evaluateBudget', () => {
  it('is the arithmetic both budget turns report', () => {
    expect(evaluateBudget(PROPOSAL_LINES, LIMIT_V1)).toEqual({ total: 1290, limit: 1200, version: 'v1', status: 'fail' });
    expect(evaluateBudget(PROPOSAL_LINES, LIMIT_V2)).toEqual({ total: 1290, limit: 1300, version: 'v2', status: 'pass' });
  });
});

describe('buildBudgetAuthorityLessons', () => {
  const lessons = buildBudgetAuthorityLessons(merge);

  it('is five turns, each one incoming frame then its recorded reply', () => {
    expect(lessons).toHaveLength(5);
    lessons.forEach((lesson, i) => {
      const previousEnd = i === 0 ? [] : lessons[i - 1].end.frames;
      expect(lesson.start.frames.slice(0, previousEnd.length)).toEqual(previousEnd);
      expect(lesson.start.frames).toHaveLength(previousEnd.length + 1);
      expect(lesson.end.frames.slice(0, lesson.start.frames.length)).toEqual(lesson.start.frames);
      expect(lesson.start.nextTurn).not.toBeNull();
      expect(lesson.end.nextTurn).toBeNull();
    });
  });

  it("Jev's question names the same proposal and rule the first budget check reads", () => {
    const view = deriveTraceView(lessons[2].end.frames);
    expect(view.pins.find((pin) => pin.id === 'question')?.text).toBe(QUESTION);
    expect(QUESTION).toContain('airfare 890 + ground 400');
    expect(QUESTION).toContain(`limit rule v1 (${LIMIT_V1.limit})`);
    expect(view.channels.budget[0]).toMatchObject({ status: 'fail', rule: 'limit-v1' });
  });

  it('every budget verdict names the rule it evaluated, and earlier ones keep theirs', () => {
    const view = deriveTraceView(lessons[4].end.frames);
    expect(view.channels.budget.map((entry) => entry.channel === 'budget' && [entry.status, entry.rule, entry.subject])).toEqual([
      ['fail', 'limit-v1', 'proposal-P'],
      ['pass', 'limit-v2', 'proposal-P'],
    ]);
    expect(view.channels.budget[1].outOfScope).toBeUndefined();
    expect(view.channels.budget[0].supersededBy).toEqual({ pin: 'limit-v2', scope: 'proposal-P', actor: 'supervisor' });
    expect(view.pins.find((pin) => pin.id === 'limit-v1')?.text).toBe(`budget ≤ ${LIMIT_V1.limit}`);
  });

  it('the grant is scoped to P, recorded not enforced, and pins v2 as P-only', () => {
    const view = deriveTraceView(lessons[3].end.frames);
    expect(view.channels.authority).toEqual([
      expect.objectContaining({ actor: 'supervisor', from: 'limit-v1', to: 'limit-v2', scope: 'proposal-P', enforcement: 'simulated' }),
    ]);
    expect(view.pins.find((pin) => pin.id === 'limit-v2')?.text).toContain('applies to Proposal P');
    expect(view.pins.find((pin) => pin.id === 'limit-v2')?.text).toContain(`${LIMIT_V2.limit}`);
  });

  it('every frame is marked scripted; the Jev answer is marked simulated', () => {
    const frames = lessons[4].end.frames;
    expect(frames.every((frame) => frame.provenance.scripted)).toBe(true);
    const answer = frames.flatMap((frame) => metaOf(frame.envelope)?.pins ?? []).find((pin) => pin.id === 'jev-answer');
    expect(answer?.simulated).toBeTruthy();
  });

  it('refuses to tell this story over a conflicted merge', () => {
    expect(() => buildBudgetAuthorityLessons({ ...merge, conflicts: 1 })).toThrow(/clean merge/);
  });
});
