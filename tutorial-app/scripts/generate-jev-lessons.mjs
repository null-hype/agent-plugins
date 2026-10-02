import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ entryPoints: [app + 'src/lib/jevReportTrace.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { jevReportTrace } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const recorded = JSON.parse(readFileSync(app + 'src/stories/fixtures/jev-recorded-run.json', 'utf8'));
const lessons = ['1-reproduce-the-flaw', '2-block-unauthorized-access', '3-preserve-owner-access'];
for (const [question, lesson] of lessons.entries()) {
  const base = app + `src/content/tutorial/part-5/private-document/${lesson}`;
  for (const solved of [false, true]) {
    const dir = `${base}/${solved ? '_solution' : '_files'}`;
    mkdirSync(dir, { recursive: true });
    const state = jevReportTrace(recorded, { question, solved });
    const frameIds = state.frames.map((frame, index) => {
      const id = `${frame.reportView.selected}:${index % 2 ? 'evaluation' : 'evidence'}`;
      writeFileSync(`${dir}/frame-${id}.json`, JSON.stringify(frame, null, 2) + '\n');
      return id;
    });
    writeFileSync(`${dir}/acp-trace.json`, JSON.stringify({ scenario: state.scenario, frameIds, nextTurn: state.nextTurn }, null, 2) + '\n');
  }
}
