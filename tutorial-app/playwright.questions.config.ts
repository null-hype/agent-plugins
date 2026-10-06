import { defineConfig, type Project } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// CIT-317: one config, driven by Questions. Each part names the Pkl module that
// holds its Questions; every Question becomes one Playwright project, with the
// Question's own dependencies, running the generic `tests/questions/question.spec.ts`
// (which runs the collector the Question names). A part's lesson and browser
// checks are ordinary projects that depend on its Questions. Parts move over
// from their own configs one at a time; the rails probes are the first.
//
//   npx playwright test --config=playwright.questions.config.ts
//   npx playwright test --config=playwright.questions.config.ts --project 'rails-probes/*' --project rails-probes:lesson
//   CIT307_UPDATE=1 npx ...     # rewrite the rails probes' committed reproduction + fixtures
//
// A Question project fails only when its answer could not be collected, and only
// then are its dependents skipped. An answer outside the expected range is
// recorded (an `outcome` annotation) and its dependents run.
//
// Needs `pkl` on PATH (the rails probes' checker output is read in the Pkl 0.32
// format). The `editor` project needs a browser and the acp-trace server; the
// `playback` project needs the TutorialKit dev server and network (WebContainer
// runs npm install). Both servers start below.

const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
  : {};

const PARTS: { name: string; module: string; projects: Project[] }[] = [
  {
    name: 'rails-probes',
    module: 'tests/rails-probes/traces/CheckerProbes.pkl',
    // The tutorial reporter writes the lesson into src/content/tutorial/part-4
    // (the chapter directory is rewritten on every compile; commit what it produces).
    projects: [
      { name: 'lesson', testMatch: 'rails-probes/rails-probes.tutorial.spec.ts' },
      {
        name: 'editor',
        testMatch: 'rails-probes/rails-probes.editor.spec.ts',
        dependencies: ['lesson'],
        use: { baseURL: 'http://127.0.0.1:4383', headless: true, viewport: { width: 1400, height: 900 }, launchOptions },
      },
      {
        name: 'playback',
        testMatch: 'rails-probes/rails-probes.playback.spec.ts',
        dependencies: ['lesson'],
        use: { baseURL: 'http://localhost:4321', headless: true, viewport: { width: 1440, height: 900 }, launchOptions, screenshot: 'only-on-failure' },
      },
    ],
  },
];

// The main process reads the Questions and makes the run directory once; workers
// load this config again and inherit both through the environment.
const results = path.resolve('test-results/questions');
if (!process.env.QUESTIONS_SNAPSHOT) {
  mkdirSync(results, { recursive: true });
  process.env.QUESTIONS_RUN_DIR = mkdtempSync(path.join(results, 'run-'));
  const snapshot = Object.fromEntries(
    PARTS.map(({ name, module }) => [
      name,
      JSON.parse(execFileSync('pkl', ['eval', '-x', 'new JsonRenderer {}.renderValue(questions)', module], { encoding: 'utf8' })),
    ]),
  );
  process.env.QUESTIONS_SNAPSHOT = path.join(process.env.QUESTIONS_RUN_DIR, 'questions.json');
  writeFileSync(process.env.QUESTIONS_SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
}
const questions: Record<string, Record<string, any>> = JSON.parse(readFileSync(process.env.QUESTIONS_SNAPSHOT, 'utf8'));

// Project names are `<part>/<question id>` for Questions and `<part>:<name>` otherwise.
const projects = PARTS.flatMap(({ name: part, projects }) => {
  const asked = Object.entries(questions[part]).map(([id, question]) => ({
    name: `${part}/${id}`,
    testMatch: 'questions/question.spec.ts',
    dependencies: question.dependencies.map((dependency: string) => `${part}/${dependency}`),
    metadata: { part, id, question },
  }));
  const rest = projects.map((project) => ({
    ...project,
    name: `${part}:${project.name}`,
    // Every other project of a part depends on all its Questions, or on a sibling that does.
    dependencies: project.dependencies?.map((dependency) => `${part}:${dependency}`) ?? asked.map(({ name }) => name),
  }));
  return [...asked, ...rest];
});

export default defineConfig({
  testDir: './tests',
  outputDir: path.join(results, 'artifacts'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  // part-4 is the rails probes' tutorial part. A second part with lessons needs
  // the reporter to take its directory per project.
  reporter: [['list'], ['./reporters/tutorial.ts', { outDir: './src/content/tutorial/part-4' }]],
  projects,
  webServer: [
    {
      command: 'node src/templates/acp-trace/server.cjs',
      url: 'http://127.0.0.1:4383',
      env: { PORT: '4383', AGENT_PORT: '4384' },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://localhost:4321',
      env: { ASTRO_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
