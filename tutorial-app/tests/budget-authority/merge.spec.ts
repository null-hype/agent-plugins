import { describe, expect, it } from 'vitest';
import { LIMIT_V1, PROPOSAL_LINES } from '../../src/lib/budgetAuthorityStoryboard';
import { mergeProposalBranches } from './merge';

describe('Budget Authority composition witness (CIT-262)', () => {
  const result = mergeProposalBranches();
  const { base, airfare, ground, merged } = result.worlds;

  it('merges two independently based commits without textual conflicts or lost facts', () => {
    expect(airfare.parents).toEqual([base.commit]);
    expect(ground.parents).toEqual([base.commit]);
    expect(merged.parents).toEqual([airfare.commit, ground.commit]);
    expect(result.conflicts).toBe(0);
    expect(base.lines).toEqual([]);
    expect(airfare.lines).toEqual([PROPOSAL_LINES[0]]);
    expect(ground.lines).toEqual([PROPOSAL_LINES[1]]);
    expect(merged.lines).toEqual(PROPOSAL_LINES);
  });

  it('passes base, A and B but fails their merge under the same frozen rule', () => {
    expect(Object.isFrozen(result.rule)).toBe(true);
    expect(result.rule).toEqual(LIMIT_V1);
    expect(Object.values(result.worlds).map(({ evaluation }) => evaluation)).toEqual([
      { total: 0, limit: 1200, version: 'v1', status: 'pass' },
      { total: 890, limit: 1200, version: 'v1', status: 'pass' },
      { total: 400, limit: 1200, version: 'v1', status: 'pass' },
      { total: 1290, limit: 1200, version: 'v1', status: 'fail' },
    ]);
  });
});
