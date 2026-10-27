import type { FullConfig, Reporter, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { noul, TypeSafeClient } from '@typesafe-ai/sdk';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeWitnessRun } from '../findings.mjs';
import { JEV_KEY, secret } from './fixtures';

// The run's priorities, from Jev. Each item of work is a test, or, once Jules
// has planned a test, a step of its plan; Jev is asked of each whether it is
// still a priority for the goal, given what the run shows done, and the items
// come back in that order. The same reporter answers at three levels:
//
//   --list                  every test, nothing run
//   --project feature-plan  Jules's plan, approved, nothing written
//   --project feature       Jules's plan, and the files it wrote
//
// so as work lands the list shifts. It writes priorities.json in test-results,
// and appends the ranking to .priorities/history.jsonl, which Playwright does
// not clear, for the report to show how each item moved since earlier runs.
// Each answer is also a witness finding on the line of the test it is work of,
// added to the run the witness reporter wrote, so the editor shows it there.
type At = { file: string; line: number; column: number };
type Item = { test: string; status: string; plan?: string[]; wrote?: { path: string; content: string }[] };

export default class PriorityReporter implements Reporter {
  private config!: FullConfig;
  private items = new Map<string, Item>();
  private at = new Map<string, At>();
  private began = new Date().toISOString();
  private created = new Set<string>();

  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    this.began = new Date().toISOString();
    for (const t of suite.allTests()) if (t.location.file.endsWith('.spec.ts') && !t.location.file.endsWith('audit.spec.ts')) {
      this.items.set(t.title, { test: t.title, status: 'not run' });
      this.at.set(t.title, t.location);
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (!this.items.has(test.title)) return;
    for (const a of [...test.annotations, ...result.annotations]) if (a.type === 'jules session created' && a.description) this.created.add(a.description);
    const item: Item = { test: test.title, status: result.status };
    for (const s of result.steps) {
      if (s.title === "Approve Jules's plan") item.wrote = s.steps.flatMap((f) => wrote(f, result));
      else if (s.category === 'test.step' && s.steps.some((x) => x.category === 'test.step')) item.plan = s.steps.map((x) => x.title);
    }
    this.items.set(test.title, item);
  }

  async onEnd() {
    if (!this.items.size) return;
    const { goal, question } = this.config.metadata.delivery as { goal: string; question: string };
    const state = { goal, tests: [...this.items.values()] };
    const work = state.tests.flatMap((t) => t.plan?.map((s) => ({ test: t.test, step: s, work: `${t.test} — ${s}` })) ?? [{ test: t.test, work: t.test }]);
    const client = new TypeSafeClient({ apiKey: secret('judge', JEV_KEY, `ask Jev what is still a priority toward ${goal}`) });
    const { answers, model } = await client.systemOne({
      state,
      questions: Object.fromEntries(work.map((w, i) => [`is_priority_${i}`, noul(`${question} ${w.work}`)])),
    });
    const ranked = work.map((w, i) => ({ p: answers[`is_priority_${i}`].noul, work: w.work })).sort((a, b) => b.p - a.p);
    const out = path.join(this.config.rootDir, 'test-results', 'priorities.json');
    mkdirSync(path.dirname(out), { recursive: true });
    const level = state.tests.some((t) => t.wrote?.length) ? 'work' : state.tests.some((t) => t.plan) ? 'plan' : 'list';
    const run = { began: this.began, julesSessionsCreated: [...this.created].sort(), at: new Date().toISOString(), level, model, ranked };
    writeFileSync(out, JSON.stringify({ ...run, state }, null, 2) + '\n');
    const history = path.join(this.config.rootDir, '.priorities', 'history.jsonl');
    mkdirSync(path.dirname(history), { recursive: true });
    appendFileSync(history, JSON.stringify(run) + '\n');
    this.witness(work.map((w, i) => ({ ...w, p: answers[`is_priority_${i}`].noul })), out);
    console.log(`\nPriorities (${model}):\n${ranked.map((r) => `  ${r.p.toFixed(2)}  ${r.work}`).join('\n')}`);
  }

  /** Adds each answer to .witness/run beside the config, on its test's line. */
  private witness(answers: { test: string; step?: string; p: number }[], evidence: string) {
    const root = path.dirname(this.config.configFile ?? this.config.rootDir);
    const run = path.join(root, '.witness', 'run');
    const before = existsSync(path.join(run, 'findings.json')) ? JSON.parse(readFileSync(path.join(run, 'findings.json'), 'utf8')).findings : [];
    // A run's own answers replace any an earlier run left there.
    const kept = before.filter((f: { id: string }) => !f.id.startsWith('priority: '))
      .map((f: { evidence?: string[] }) => ({ ...f, evidence: (f.evidence ?? []).map((e) => ({ name: e, from: path.join(run, e) })) }));
    writeWitnessRun(root, [...kept, ...answers.map((a) => {
      const at = this.at.get(a.test)!;
      return {
        id: `priority: ${a.step ?? a.test}`, severity: 'information',
        message: `${a.p.toFixed(2)} still a priority: ${a.step ?? a.test}`,
        location: { file: path.relative(root, at.file), line: at.line, column: at.column },
        evidence: [{ name: 'priorities.json', from: evidence }],
      };
    })], root);
  }
}

/** A file Jules wrote: a step the approve fixture names for it, with the file attached. */
function wrote(step: TestStep, result: TestResult) {
  const m = step.title.match(/^Jev: does (.+) do what the plan said\?$/);
  const a = m && result.attachments.find((x) => x.name === m[1]);
  return m ? [{ path: m[1], content: a?.path ? readFileSync(a.path, 'utf8') : a?.body?.toString() ?? '' }] : [];
}
