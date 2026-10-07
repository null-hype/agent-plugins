import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const module = fileURLToPath(new URL('./ForecastReplay.pkl', import.meta.url));
const committed = new URL('./forecast-replay.json', import.meta.url);

describe('forecast replay', () => {
  // The story reads the rendered JSON; Pkl is the record it comes from.
  it('is what ForecastReplay.pkl renders from the tree and the retained round', () => {
    const rendered = execFileSync('pkl', ['eval', '-f', 'json', module], { encoding: 'utf8' });
    expect(readFileSync(committed, 'utf8')).toBe(rendered);
  });

  it('keeps the original forecast, the implied one and the accounted difference', () => {
    const replay = JSON.parse(readFileSync(committed, 'utf8'));
    const [root] = replay.solved.frames[1].envelope.result._meta.probes;
    expect(root.question).toContain('Forecast: 50% yes.');
    expect(root.children.map((child: { question: string }) => child.question.match(/Forecast: (\d+)%/)![1])).toEqual(['40', '80']);
    expect(root.unfolded.message).toContain('imply 32% read as independent (40% × 80%): a difference of -0.18, accounted for');
    // The retained round resolved nothing: no answer or score is shown.
    expect(JSON.stringify(replay)).not.toMatch(/resolved (yes|no)|brier/i);
  });
});

describe('forecast replay evidence', () => {
  const replay = JSON.parse(readFileSync(committed, 'utf8'));
  const questions = new URL('../../../src/cve-2026-66066/questions/', import.meta.url);
  const source = 'https://github.com/null-hype/agent-plugins/blob/c897e8d41b633fc539b9bd558c7e7bd69f18d369/src/cve-2026-66066/questions/';
  const probes: any[] = [];
  const walk = (probe: any) => { probes.push(probe); (probe.children || []).forEach(walk); };
  replay.solved.frames[1].envelope.result._meta.probes.forEach(walk);
  const related = probes.flatMap((probe) => [probe.diagnostic, probe.unfolded].filter(Boolean)).flatMap((d) => d.related);

  // Each location must span exactly the record it describes in the retained file.
  it('points every register and monitor location at the entry it names', () => {
    for (const entry of related.filter((r: any) => /\.json$/.test(r.uri))) {
      const lines = readFileSync(new URL(entry.uri.slice(source.length), questions), 'utf8').split('\n');
      const text = lines.slice(entry.line - 1, entry.endLine).join('\n').replace(/,$/, '');
      const body = entry.uri.endsWith('register.json') ? JSON.parse(`{${text}}`) : JSON.parse(text);
      if (entry.uri.endsWith('monitor.json')) {
        expect(entry.detail).toBe(`${body.action} at ${body.time}: ${body.reason}`);
        expect(entry.role).toBe(/: read back/.test(body.reason) ? 'read-back' : /: (register|fill)$/.test(body.reason) ? 'registration' : 'observation');
      } else {
        const [[, held]] = Object.entries(body) as [string, any][];
        expect(entry.detail).toContain(`read back ${held.held}`);
      }
    }
    expect(related.filter((r: any) => r.role === 'registration').length).toBeGreaterThan(0);
    expect(related.filter((r: any) => r.role === 'read-back').length).toBeGreaterThan(0);
  });
});
