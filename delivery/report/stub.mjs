// Writes stub.json: a finished delivery run in Playwright's JSON reporter
// format, written by hand, to settle the report before any of it is real.
import { writeFileSync } from 'node:fs';

const b64 = (s) => Buffer.from(s).toString('base64');
const jules = (id) => `https://jules.google.com/session/${id}`;

// One change: a step of the plan, at its line, with one Jules session writing one
// file and one Jev verdict on it. Playwright's JSON reporter leaves out a step's
// location; ours records it, since the editor places each answer by it.
let spec = '';
const hunk = (title, line, file, session, p, body, extra = {}) => ({
  step: { title, file, location: { file: spec, line, column: 3 }, duration: 240_000 + Math.round((p ?? 0) * 90_000), steps: [
    { title: `Jules writes ${file}`, duration: 230_000 },
    { title: `Jev: does ${file} do what was asked?`, duration: 2_400 },
  ], ...extra.step },
  attachments: body ? [{ name: file, contentType: 'text/plain', body: b64(body) }] : [],
  annotations: [
    { type: 'jules', description: `${file}  ${jules(session)}` },
    ...(p == null ? [] : [{ type: 'does-what-was-asked', description: `${p}  ${file}` }]),
    ...(extra.annotations ?? []),
  ],
});

const test = (project, file, title, status, line, hunks, more = {}) => {
  return {
    file: `delivery/${file}`, title, line,
    tests: [{
      projectName: project, status: status === 'passed' ? 'expected' : status === 'skipped' ? 'skipped' : 'unexpected',
      annotations: [...hunks.flatMap((h) => h.annotations), ...(more.annotations ?? [])],
      results: status === 'skipped' ? [] : [{
        status, duration: hunks.reduce((n, h) => n + h.step.duration, 0),
        steps: hunks.map((h) => h.step), attachments: hunks.flatMap((h) => h.attachments),
        errors: more.error ? [{ message: more.error }] : [],
      }],
    }],
  };
};

const question = 'The module is not tagged yet, so "latest" will not resolve. Should install.sh build jev-lsp from a branch, from a commit, or should I wait for a tagged release?';

// Each spec is named before its changes, so they take its file.
const at = (file, f) => { spec = `delivery/${file}`; return f(); };
const specs = [
  at('jev-ts.spec.ts', () => test('jev-ts', 'jev-ts.spec.ts', 'Can the harness ask Jev from TypeScript, with no Python?', 'passed', 9, [
    hunk('Write the Jev client in TypeScript', 12, 'jev.ts', '6021448811736510042', 0.91, "export async function noul(apiKey, state, instructions) {\n  // POST /v1/systemone, model jev-latest, one Noul question\n}\n"),
    hunk('Have score.mjs ask Jev through it', 20, 'score.mjs', '6021448811736510519', 0.84, "import { noul } from './jev.ts';\n// was: spawn .venv/bin/python\n"),
    hunk('Drop pkl-python from the install', 28, 'package.json', '6021448811736510733', 0.88, '{ "name": "jev-playwright", "type": "module" }\n'),
  ])),
  at('dagger.spec.ts', () => test('dagger', 'dagger.spec.ts', 'Do the mechanical steps run in Dagger from a Playwright fixture?', 'passed', 9, [
    hunk('Write a Dagger fixture', 12, 'dagger.ts', '6021448811736511204', 0.77, "export const dagger = base.extend({ engine: async ({}, use) => { /* connect */ } });\n"),
  ])),
  at('package.spec.ts', () => test('package', 'package.spec.ts', 'Can any Playwright project install the fixtures?', 'passed', 9, [
    hunk('Export the fixtures and reporter', 12, 'package.json', '6021448811736511881', 0.81, '{ "exports": { "./fixtures": "./ask.ts", "./reporter": "./reporter.ts" } }\n'),
    hunk('Document the install', 20, 'README.md', '6021448811736512090', 0.69, '## Install\n\nnpm i -D jev-playwright\n'),
  ])),
  at('feature.spec.ts', () => test('feature', 'feature.spec.ts', 'Can one dev container feature install jev-lsp and its Neovim setup?', 'failed', 9, [
    hunk("Write the feature's manifest", 12, 'src/jev-lsp/devcontainer-feature.json', '6021448811736512577', 0.93, '{ "id": "jev-lsp", "version": "0.1.0", "options": { "version": { "type": "string", "default": "latest" } } }\n'),
    hunk('Write the install script', 19, 'src/jev-lsp/install.sh', '6021448811736512812', null, null, {
      step: { error: { message: `Jules is waiting for an answer: ${jules('6021448811736512812')}\n\n${question}` } },
      annotations: [{ type: 'jules asks', description: question }],
    }),
  ], { error: `Jules is waiting for an answer: ${jules('6021448811736512812')}` })),
  test('goal', 'goal.spec.ts', 'Can someone install jev-lsp and see each answer on the line of the test that asked it?', 'skipped', 9, []),
  test('audit', 'audit.spec.ts', 'Is anything this run asked for still a priority?', 'passed', 22, [], {
    annotations: [
      { type: 'is-priority', description: '0.06  jev-root  start the planner' },
      { type: 'is-priority', description: '0.05  jev-planner  have Jules write one file of each node' },
      { type: 'is-priority', description: '0.05  jev-judge  ask Jev whether each file does what was asked' },
      { type: 'is-priority', description: `0.88  jules  ${question}` },
      { type: 'triage', description: `0.88  Jules asks about src/jev-lsp/install.sh  ${jules('6021448811736512812')}` },
    ],
  }),
];

const deps = { dagger: ['jev-ts'], package: ['dagger'], feature: ['package'], goal: ['feature'] };
writeFileSync(new URL('stub.json', import.meta.url), JSON.stringify({
  config: { metadata: { goal: 'People can install jev-lsp and see each answer on the line of the test that asked it.', delivery: { moved: 0.14 } },
    projects: ['jev-ts', 'dagger', 'package', 'feature', 'goal', 'audit'].map((name) => ({ name, dependencies: deps[name] ?? [] })) },
  suites: specs.map(({ file, title, line, tests }) => ({ title: file, file, specs: [{ title, file, line, column: 1, ok: tests[0].status !== 'unexpected', tests }] })),
  stats: { startTime: '2026-10-26T06:30:00.000Z', duration: 1_874_000, expected: 4, unexpected: 1, skipped: 1, flaky: 0 },
  errors: [],
}, null, 2) + '\n');
