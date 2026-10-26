// The finish report: a delivery run's Playwright JSON report as one HTML page.
// It reads only what Playwright records: projects and their dependencies, each
// test's steps (a hunk each), attachments (the files Jules wrote) and
// annotations (Jules sessions, Jev's answers, urgency).

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const split = (d) => { const m = /^(\S+)\s+(.*)$/s.exec(d ?? ''); return m ? [m[1], m[2]] : ['', d ?? '']; };
const mins = (ms) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);
const URGENT = 0.5;

function nodes(report) {
  const byProject = new Map();
  for (const suite of report.suites) for (const spec of suite.specs) for (const t of spec.tests) {
    byProject.set(t.projectName, { spec, test: t, result: t.results.at(-1) });
  }
  return report.config.projects.map((p) => ({ dependencies: [], ...p, ...byProject.get(p.name) })).filter((n) => n.spec);
}

function status(n) {
  if (!n.result) return ['skipped', 'did not run'];
  return n.result.status === 'passed' ? ['passed', 'passed'] : ['failed', n.test.annotations.some((a) => a.type === 'jules asks') ? 'waiting on an answer' : 'failed'];
}

function hunks(n) {
  if (!n.result) return '';
  const notes = n.test.annotations;
  const files = new Map(n.result.attachments.map((a) => [a.name, Buffer.from(a.body ?? '', 'base64').toString()]));
  return `<ol class="hunks">${n.result.steps.map((step) => {
    const file = step.file;
    // A step with no file is Jules's plan for a task: its steps are the plan.
    if (!file) {
      const plan = notes.find((a) => a.type === 'jules plan');
      const asks = step.error ? notes.find((a) => a.type === 'jules asks') : null;
      return `<li class="${step.error ? 'blocked' : ''}">
      <div class="row">
        <span class="change">${esc(step.title)}<span class="where">Jules's plan${step.steps?.length ? `, ${step.steps.length} steps` : ''}</span></span>
        ${plan ? `<a href="${esc(plan.description)}">Jules</a>` : ''}
      </div>
      ${step.steps?.length ? `<ol class="plan">${step.steps.map((s) => `<li>${esc(s.title)}</li>`).join('')}</ol>` : ''}
      ${asks ? `<p class="asks"><b>Jules replied:</b> ${esc(asks.description)}</p>` : step.error ? `<p class="asks">${esc(step.error.message)}</p>` : ''}
    </li>`;
    }
    const session = notes.find((a) => a.type === 'jules' && split(a.description)[0] === file);
    const verdict = notes.find((a) => a.type === 'does-what-was-asked' && split(a.description)[1] === file);
    const p = verdict ? Number(split(verdict.description)[0]) : null;
    const asks = step.error ? notes.find((a) => a.type === 'jules asks') : null;
    return `<li class="${step.error ? 'blocked' : ''}">
      <div class="row">
        <span class="change">${esc(step.title)}<span class="where"><code>${esc(file)}</code> · line ${step.location?.line ?? '?'}</span></span>
        ${p == null ? '<span class="score none">no answer</span>' : `<span class="score"><span class="bar" style="--p:${p}"></span>${p.toFixed(2)}</span>`}
        ${session ? `<a href="${esc(split(session.description)[1])}">Jules</a>` : ''}
      </div>
      ${asks ? `<p class="asks"><b>Jules asks:</b> ${esc(asks.description)}</p>` : ''}
      ${files.has(file) ? `<details><summary>file</summary><pre>${esc(files.get(file))}</pre></details>` : ''}
    </li>`;
  }).join('')}</ol>`;
}

export function render(report) {
  const all = nodes(report);
  const audit = all.find((n) => n.name === 'audit');
  const work = all.filter((n) => n.name !== 'audit');
  const urgency = (audit?.test.annotations ?? []).filter((a) => a.type === 'is_urgent')
    .map((a) => { const [p, rest] = split(a.description); const [who, why] = split(rest); return { p: Number(p), who, why }; })
    .sort((a, b) => b.p - a.p);
  const triage = (audit?.test.annotations ?? []).filter((a) => a.type === 'triage').map((a) => split(a.description));
  const goalNode = work.find((n) => n.name === 'goal');
  const blocked = work.find((n) => status(n)[0] === 'failed');
  const verdict = goalNode && status(goalNode)[0] === 'passed' ? 'The goal holds.'
    : blocked ? `Not yet: stopped at ${blocked.name}, ${status(blocked)[1]}.` : 'Not yet.';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Delivery report</title><style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a65;--line:#e4e1d8;--card:#fff;--ok:#2f7d4f;--bad:#b4442c;--wait:#a86a00;--bar:#3a6ea5}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--mute:#9a988f;--line:#2f2e2a;--card:#1e1e1b;--ok:#5fb37f;--bad:#e07a62;--wait:#e0a83a;--bar:#7aa7d6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 16px 60px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:32px 0 10px;color:var(--mute);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.verdict{font-size:18px;margin:14px 0 4px}.meta{color:var(--mute);font-size:13px}
.node{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:10px 0}
.node h3{margin:0;font-size:16px;display:flex;gap:10px;align-items:baseline}.node .where{color:var(--mute);font-size:12px;margin-top:2px}
.dot{width:10px;height:10px;border-radius:50%;flex:none;transform:translateY(-1px)}.passed .dot{background:var(--ok)}.failed .dot{background:var(--wait)}.skipped .dot{border:2px solid var(--mute)}
.state{font-size:12px;color:var(--mute);margin-left:auto;white-space:nowrap}.failed .state{color:var(--wait)}
.hunks{list-style:none;padding:0;margin:10px 0 0}.hunks li{border-top:1px solid var(--line);padding:8px 0}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.change{flex:1;min-width:200px}.change .where{display:block;color:var(--mute);font-size:12px}.change code{font-size:12px}.row a{font-size:13px;color:var(--bar)}
.score{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums;font-size:13px}.score.none{color:var(--mute)}
.bar{width:70px;height:6px;border-radius:3px;background:linear-gradient(90deg,var(--bar) calc(var(--p)*100%),var(--line) 0)}
.asks{margin:8px 0 0;padding:8px 10px;border-left:3px solid var(--wait);background:color-mix(in srgb,var(--wait) 10%,transparent);font-size:14px}
details{margin-top:6px}summary{cursor:pointer;color:var(--mute);font-size:12px}pre{overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:14px}td{border-top:1px solid var(--line);padding:6px 4px;vertical-align:top}td.p{width:56px;font-variant-numeric:tabular-nums}tr.hot td{color:var(--wait);font-weight:600}
.dep{color:var(--mute);font-size:12px}
.plan{margin:6px 0 0;padding-left:22px;font-size:14px}.plan li{border:0;padding:2px 0}
</style></head><body><main>
<h1>${esc(report.config.metadata?.goal)}</h1>
<p class="verdict">${esc(verdict)}</p>
<p class="meta">${esc(new Date(report.stats.startTime).toISOString().slice(0, 16).replace('T', ' '))} UTC · ${mins(report.stats.duration)} · ${report.stats.expected} passed, ${report.stats.unexpected} failed, ${report.stats.skipped} did not run</p>

${triage.length ? `<h2>Triage</h2><table>${triage.map(([p, what]) => `<tr class="hot"><td class="p">${esc(p)}</td><td>${esc(what.replace(/\s+https:\S+$/, ''))} ${(/https:\S+$/.exec(what) ?? [''])[0] ? `<a href="${esc(/https:\S+$/.exec(what)[0])}">open</a>` : ''}</td></tr>`).join('')}</table>` : ''}

<h2>The plan, in order</h2>
${work.map((n) => { const [cls, label] = status(n); return `<section class="node ${cls}" id="${esc(n.name)}">
  <h3><span class="dot"></span>${esc(n.spec.title)}<span class="state">${esc(label)}</span></h3>
  <div class="where">${esc(n.spec.file)}:${n.spec.line} · ${esc(n.name)}${n.dependencies.length ? ` <span class="dep">after ${esc(n.dependencies.join(', '))}</span>` : ''}</div>
  ${hunks(n)}
</section>`; }).join('\n')}

${urgency.length ? `<h2>Urgency</h2><table>${urgency.map((u) => `<tr class="${u.p >= URGENT ? 'hot' : ''}"><td class="p">${u.p.toFixed(2)}</td><td><b>${esc(u.who)}</b> ${esc(u.why)}</td></tr>`).join('')}</table>` : ''}
</main></body></html>`;
}

// The same run as jev-lsp reads it: one Question per change, at the line of the
// step that made it, and one per test that did not run. A change whose file Jev
// judged below EXPECTED.min is out of range; one Jules stopped on, to ask, has
// no answer.
export const EXPECTED = { min: 0.7, max: 1 };

export function toComparison(report) {
  const questions = {};
  for (const n of nodes(report)) {
    if (n.name === 'audit') continue;
    if (!n.result) {
      questions[n.name] = { location: { file: n.spec.file, line: n.spec.line, column: 1 }, outcome: 'dependency-skipped', blockedBy: n.dependencies, probability: null, expected: EXPECTED, error: null };
      continue;
    }
    for (const step of n.result.steps) {
      const verdict = n.test.annotations.find((a) => a.type === 'does-what-was-asked' && split(a.description)[1] === step.file);
      const p = verdict ? Number(split(verdict.description)[0]) : null;
      questions[`${n.name}: ${step.title}`] = {
        location: step.location, blockedBy: [], probability: p, expected: EXPECTED,
        outcome: step.error ? 'execution-failed' : p != null && (p < EXPECTED.min || p > EXPECTED.max) ? 'out-of-range' : 'in-range',
        error: step.error ? step.error.message.split('\n\n').at(-1) : null,
      };
    }
  }
  return { runId: report.stats.startTime, questions };
}

// node render.mjs report.json out.html
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[3], render(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
}
