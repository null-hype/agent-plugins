import { describe, expect, it } from 'vitest';
import { projectPreregistration, type ClaimPreregistration } from './claimPreregistration';
import completedFixture from '../../../.dagger/internal/devenv-base/toolbox/testdata/completed-claim-preregistration.json';
const artifact = completedFixture.preregistration as ClaimPreregistration;

describe('Witness findings on preregistration', () => {
  it('preserves check messages and locations, including the checked source hash', async () => {
    const view = await projectPreregistration(artifact);
    expect(view.diagnostics).toEqual([{ line: 6, column: 5, severity: 'warning', message: artifact.findings!.findings[0].message, evidence: ['evidence/verdict.json'] }]);
  });
  it('retains stale findings with the Witness warning and never relocates unrelated or invalid findings', async () => {
    const original = artifact.findings!.findings[0];
    const view = await projectPreregistration({ ...artifact, findings: { version: 1, findings: [
      { ...original, sourceHash: 'sha256:other' },
      { ...original, location: { ...original.location, file: 'test.spec.ts' } },
      { ...original, location: { ...original.location, line: 999 } },
      { ...original, location: { ...original.location, column: 999 } },
    ] } });
    expect(view.diagnostics).toHaveLength(1);
    expect(view.diagnostics[0].message).toMatch(/^stale finding \(verified against other source\): /);
    expect(view.notice).toMatch(/^3 finding/);
  });
  it('distinguishes no findings from absent or unsupported findings', async () => {
    expect((await projectPreregistration({ ...artifact, findings: null })).notice).toContain('unavailable');
    expect((await projectPreregistration({ ...artifact, findings: { version: 2, findings: [] } })).notice).toContain('Unsupported');
    expect((await projectPreregistration({ ...artifact, findings: { version: 1, findings: [] } })).notice).toBe('No findings on this preregistration.');
  });
});
