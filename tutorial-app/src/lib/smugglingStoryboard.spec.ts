import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { assertAcpVerdict, deriveTraceView, metaOf, parseAcpTraceFixtureRef, resolveAcpTraceFixture, type AcpFrame } from './acpTraceProtocol';

const root = new URL('../content/tutorial/part-4/smuggling-survives-the-merge/', import.meta.url);
const lessons = readdirSync(root).filter((name) => /^\d-/.test(name)).sort();
function fixture(lesson: string, stage: string) {
  const dir = new URL(`${lesson}/${stage}/`, root);
  return resolveAcpTraceFixture(
    parseAcpTraceFixtureRef(readFileSync(new URL('acp-trace.json', dir), 'utf8')),
    (id) => readFileSync(new URL(`frame-${id}.json`, dir), 'utf8'),
  );
}

// Execute the actual browser derivation, using the same template loader as Storybook.
const server = new URL('../templates/acp-trace/server.cjs', import.meta.url);
const require = createRequire(server);
const mod = { exports: {} as { renderAgentPage: () => string; renderClientPage: () => string } };
new Function('require', 'module', readFileSync(server, 'utf8') + '\nmodule.exports = { renderAgentPage, renderClientPage };')(
  (id: string) => id === 'node:http' ? { createServer: () => ({ listen() {} }) } : require(id), mod,
);
const page = mod.exports.renderAgentPage();
const browserDerive = new Function('frames', 'metaOf',
  page.slice(page.indexOf('const VERDICT_CONTRACT'), page.indexOf('const CHANNEL_TITLES')) + '\nreturn deriveTraceView(frames);',
);

describe('CIT-255 concept storyboard', () => {
  it('preserves every frame identity through Solve and subsequent lessons', () => {
    const identities = new Map<string, AcpFrame>();
    let previous: AcpFrame[] = [];
    for (const lesson of lessons) {
      const start = fixture(lesson, '_files');
      const end = fixture(lesson, '_solution');
      expect(start.frames.slice(0, previous.length)).toEqual(previous);
      expect(end.frames.slice(0, start.frames.length)).toEqual(start.frames);
      expect(start.nextTurn).not.toBeNull();
      expect(end.nextTurn).toBeNull();
      for (const frame of [...start.frames, ...end.frames]) {
        const id = frame.provenance.recordingId;
        if (identities.has(id)) expect(frame).toEqual(identities.get(id));
        identities.set(id, frame);
      }
      previous = end.frames;
    }
  });

  it('derives all actual fixture verdicts consistently in both clients', () => {
    for (const lesson of lessons) for (const stage of ['_files', '_solution']) {
      const { frames } = fixture(lesson, stage);
      const view = deriveTraceView(frames);
      const browser = browserDerive(frames, metaOf);
      for (const [channel, entries] of Object.entries(view.channels)) {
        expect((browser.channels[channel] ?? []).map(({ latest, ...entry }: any) => entry)).toEqual(entries);
      }
    }
  });

  it('keeps approvals, the illustrative merge and the missing experiment distinct', () => {
    const frames = fixture(lessons[2], '_solution').frames;
    const view = deriveTraceView(frames);
    expect(view.scripted).toContain('Concept storyboard');
    expect(view.channels.review.map((v) => v.status)).toEqual(['pending', 'approved', 'flagged']);
    expect(view.channels.merge[0]).toMatchObject({ status: 'clean', text: expect.stringContaining('illustrative defenses.md') });
    expect(view.channels.experiment).toEqual([{ channel: 'experiment', status: 'not-run', text: expect.stringContaining('NOT RUN') }]);
    expect(view.pins.find((pin) => pin.id === 'real-baseline')?.text).toContain('https://dagger.cloud/salute-stopping/traces/c183381dd44d9712748b815d3c6d2943');
    expect(mod.exports.renderClientPage()).toContain('Reveal storyboard diagnostic:');
    expect(mod.exports.renderClientPage()).not.toContain('Click to run ');
  });

  it.each([
    { channel: 'smuggling', status: 'FAIL (simulated)', text: 'invalid old fixture' },
    { channel: 'review', status: 'fail', text: 'wrong channel status' },
    { channel: '__proto__', status: 'clean', text: 'unknown channel' },
  ])('rejects unsupported verdicts rather than masking drift: %j', (verdict) => {
    expect(() => assertAcpVerdict(verdict)).toThrow('Invalid ACP verdict');
    const frame = { actor: 'agent', action: 'test', envelope: { jsonrpc: '2.0', result: { _meta: { verdict } } }, provenance: { recordingId: 'test', capturedAt: 'n/a' } } as AcpFrame;
    expect(() => deriveTraceView([frame])).toThrow('Invalid ACP verdict');
    expect(() => browserDerive([frame], metaOf)).toThrow('Invalid ACP verdict');
  });
});
