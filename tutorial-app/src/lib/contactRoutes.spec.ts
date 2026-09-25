import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Contact and Conversion Paths (CIT-166, CIT-259, CIT-165)', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const tutorialDir = path.resolve(__dirname, '../..');
  const launchDir = path.resolve(rootDir, 'docs/launch');


  it('provides public issue template for open collaboration', () => {
    const issueTemplatePath = path.resolve(rootDir, '.github/ISSUE_TEMPLATE/apply-this.yml');
    expect(fs.existsSync(issueTemplatePath)).toBe(true);
    const content = fs.readFileSync(issueTemplatePath, 'utf8');
    expect(content).toContain('name: Discuss applying this to an agent system');
    expect(content).toContain('do not include secrets or private details');
  });

  it('exposes dual contact routes in root README.md', () => {
    const readmePath = path.resolve(rootDir, 'README.md');
    const content = fs.readFileSync(readmePath, 'utf8');
    expect(content).toContain('https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml');
    expect(content).toContain('public.rant@pm.me');
    expect(content).toContain('do not send credentials, API keys, or unredacted secrets');
  });

  it('exposes dual contact routes in profile/README.md', () => {
    const profileReadmePath = path.resolve(rootDir, 'profile/README.md');
    const content = fs.readFileSync(profileReadmePath, 'utf8');
    expect(content).toContain('https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml');
    expect(content).toContain('public.rant@pm.me');
    expect(content).toContain('This profile is not a portfolio of promises; it is a log of evidence.');
  });

  it('exposes dual contact routes in top-level landing page (part-0/overview/start)', () => {
    const landingPath = path.resolve(tutorialDir, 'src/content/tutorial/part-0/overview/start/content.mdx');
    const content = fs.readFileSync(landingPath, 'utf8');
    expect(content).toContain('https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml');
    expect(content).toContain('public.rant@pm.me');
    expect(content).toContain('/part-3/proposal-p-against-the-budget/1-jev-types-the-answer');
  });


  it('maintains frozen canonical description and aha scenario status', () => {
    const canonicalPath = path.resolve(launchDir, 'canonical-description.md');
    const ahaPath = path.resolve(launchDir, 'aha-scenario.md');
    expect(fs.readFileSync(canonicalPath, 'utf8')).toContain('Status: FROZEN for launch.');
    expect(fs.readFileSync(ahaPath, 'utf8')).toContain('Status: FROZEN for launch.');
  });

  it('has valid SECURITY.md disclosure policy in repository root', () => {
    const securityPath = path.resolve(rootDir, 'SECURITY.md');
    expect(fs.existsSync(securityPath)).toBe(true);
    const content = fs.readFileSync(securityPath, 'utf8');
    expect(content).toContain('public.rant@pm.me');
    expect(content).toContain('Safe Harbor');
  });
});
