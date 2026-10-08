import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { metaOf } from './acpTraceProtocol';

const server = new URL('../templates/acp-trace/server.cjs', import.meta.url);
const require = createRequire(server);
const module = { exports: {} as any };
runInNewContext(readFileSync(server, 'utf8') + `
module.exports = { renderClientPage, activity,
  choices(reviews, current) { acceptedReviews = reviews; acceptedProbes = current; } };
`, {
  require: (id: string) => id === 'node:http' ? { createServer: () => ({ listen() {} }) } : require(id),
  module, process, console, setInterval() {}, URL,
});
const page = module.exports.renderClientPage();
// Exercise the actual Client renderer against committed lesson traces.
const render = new Function('state', 'acceptedReviews', 'acceptedOrder', 'metaOf', `
let commitRanges = [], commitEnd = 0;
const extractPromptText = (params) => params.prompt.map((block) => block.text || '').join('\\n');
${page.slice(page.indexOf('function renderReviewRecords'), page.indexOf('// What the agent offers after the commit:'))}
return renderReviewRecords(state);
`);
const root = new URL('../content/tutorial/part-5/private-document/', import.meta.url);
const load = (lesson: string, stage: string) => JSON.parse(readFileSync(new URL(`${lesson}/${stage}/acp-trace.json`, root), 'utf8'));
const baseline = load('1-is-the-private-document-private', '_solution');
const patched = load('2-does-the-owner-check-keep-the-document-private', '_solution');
const starter = load('2-does-the-owner-check-keep-the-document-private', '_files');
const key = baseline.frames[0].provenance.recordingId;
const question = (index: number) => baseline.frames[1].envelope.result._meta.probes[index].question;

describe('Private document review accumulates learner choices', () => {
  it('carries only the accepted baseline probe into the next lesson', () => {
    const rows = render(starter, { [key]: [1] }, [], metaOf);
    expect(rows.filter((row: any) => row.diagnostic).map((row: any) => row.raw)).toEqual([question(1)]);
    expect(rows.some((row: any) => row.raw === question(0))).toBe(false);
    module.exports.choices({ [key]: [1] }, []);
    const lines = module.exports.activity(starter).lines.join('\n');
    expect(lines).toContain('accepted: ' + question(1));
    expect(lines).not.toContain('baseline-alice-reads:');
  });

  it('preserves acceptance order and never accepts findings for a direct lesson visit', () => {
    expect(render(starter, { [key]: [1, 0] }, [], metaOf)
      .filter((row: any) => row.diagnostic).map((row: any) => row.raw)).toEqual([question(1), question(0)]);
    expect(render(starter, {}, [], metaOf).filter((row: any) => row.diagnostic)).toEqual([]);
    module.exports.choices({}, []);
    expect(module.exports.activity(starter).lines.join('\n')).not.toContain('accepted:');
  });

  it('compares the repeated Alice and Bob requests against baseline evidence', () => {
    const probes = patched.frames.at(-1).envelope.result._meta.probes;
    expect(probes[0].diagnostic.message).toContain('HTTP 200 → 403');
    expect(probes[1].diagnostic.message).toContain('HTTP 200 → 200');
    for (const [index, probe] of probes.entries()) {
      expect(probe.question).toBe(question(index));
      expect(probe.diagnostic.related).toContainEqual(expect.objectContaining({
        revision: 'baseline', uri: `questions/baseline-${index === 0 ? 'alice' : 'bob'}-reads/state.json`,
      }));
    }
  });

  it('retains the baseline trace unchanged before introducing the reason for the patch', () => {
    expect(starter.frames.slice(0, baseline.frames.length)).toEqual(baseline.frames);
    const prompt = starter.frames.at(-1).envelope.params.prompt[0].text;
    expect(prompt).toContain('Why this change:');
    expect(prompt).toContain('(_user, _document) => true');
    expect(prompt).toContain('document.owner === user');
  });
});
