import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Runs entirely offline; report data is embedded, never fetched or evaluated.
function viewer(data) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty = value => esc(JSON.stringify(value, null, 2));
  const title = id => id.replaceAll('-', ' ');
  const pct = n => typeof n === 'number' ? `${Math.round(n * 100)}%` : 'Not scored';
  const entries = Object.entries(data.comparison?.questions ?? {}).map(([id, result]) => ({id, ...result, state: data.states[id], definition: data.expected?.questions?.[id], score: data.ledger?.scores?.[id]}));
  const snapshots = [...new Set(entries.map(q => q.state?.revision ?? 'Unrecorded'))];
  let revision = snapshots[0];
  let selected = entries[0]?.id;
  let file = 'authorizationPolicy';
  const tone = q => q.outcome === 'in-range' ? 'pass' : q.outcome === 'dependency-skipped' ? 'blocked' : 'fail';
  const files = ['authorizationPolicy', 'http', 'fixtureState'];
  const names = {authorizationPolicy:'Authorization policy', http:'HTTP observation', fixtureState:'Fixture state'};
  function render() {
    const visible = entries.filter(q => (q.state?.revision ?? 'Unrecorded') === revision);
    const q = visible.find(q => q.id === selected) ?? visible[0];
    selected = q?.id;
    document.querySelector('#history').innerHTML = snapshots.map((r, i) => `<button data-revision="${i}" aria-pressed="${r === revision}"><span class="node">◉</span><span><b>${esc(r)}</b><small>${entries.filter(q => (q.state?.revision ?? 'Unrecorded') === r).length} evaluations</small></span></button>`).join('');
    document.querySelector('#files').innerHTML = files.map(f => `<button data-file="${f}" aria-pressed="${f === file}">${names[f]}</button>`).join('');
    document.querySelector('#revision').textContent = revision ?? 'No snapshot';
    document.querySelector('#diagnostics').innerHTML = visible.map(item => `<button class="diagnostic" data-question="${esc(item.id)}" aria-pressed="${item.id === selected}"><span class="${tone(item)}">${item.outcome === 'in-range' ? '✓' : item.outcome === 'dependency-skipped' ? '○' : '!'}</span><span><b>${esc(title(item.id))}</b><small>${esc(title(item.outcome))}</small></span><strong>${pct(item.probability)}</strong></button>`).join('') || '<p>No evaluations recorded.</p>';
    if (!q) return;
    const previous = Object.values(q.state?.prerequisites ?? {}).find(s => s.revision !== q.state?.revision);
    const before = previous?.[file];
    const after = q.state?.[file];
    const format = v => typeof v === 'string' ? esc(v) : pretty(v);
    document.querySelector('#file-title').textContent = names[file];
    document.querySelector('#source').innerHTML = after === undefined ? '<p class="empty">No evidence recorded for this evaluation.</p>' : `${before !== undefined ? `<div class="source-label">${esc(previous.revision)} → ${esc(q.state.revision)} · ${before === after ? 'unchanged' : 'recorded comparison'}</div><pre class="removed"><span aria-label="Before">− </span>${format(before)}</pre>` : '<div class="source-label">Recorded snapshot</div>'}<pre class="${before !== undefined ? 'added' : ''}"><span>${before !== undefined ? '+ ' : ''}</span>${format(after)}</pre><div class="source-label">questions/${esc(q.id)}/state.json · /state/${file}</div>`;
    document.querySelector('#detail').innerHTML = `<div class="section-heading">Evaluation details <span class="${tone(q)}">${esc(title(q.outcome))}</span></div><h2>${esc(title(q.id))}</h2><div class="metrics"><div><small>Jev score</small><strong>${pct(q.probability)}</strong></div><div><small>Expected range</small><strong>${pct(q.expected.min)}–${pct(q.expected.max)}</strong></div></div><p>${esc(q.definition?.judge?.instructions ?? 'Question unavailable.')}</p>${q.blockedBy?.length ? `<p class="notice">Blocked by ${q.blockedBy.map(esc).join(', ')}. No assessment was made.</p>` : ''}${q.error ? `<pre class="fail">${esc(q.error)}</pre>` : ''}<h3>Evidence locations</h3>${files.map(f => `<button class="location" data-file="${f}">${names[f]} ↗</button>`).join('')}<h3>Evaluation identity</h3><dl><dt>Snapshot</dt><dd>${esc(q.state?.revision ?? 'Unrecorded')}</dd><dt>Run</dt><dd>${esc(data.comparison?.runId ?? data.runId)}</dd><dt>Model / backend</dt><dd>${esc(q.score?.model ?? 'Not scored')} / ${esc(q.score?.backend ?? '—')}</dd><dt>Dependencies</dt><dd>${esc(q.dependencies?.join(', ') || 'None')}</dd></dl><details><summary>Pkl question & expectation</summary><pre>${pretty(q.definition)}</pre><a href="report-expected.json">Open expected ledger</a></details><details><summary>Complete collected evidence</summary><pre>${pretty(q.state ?? null)}</pre></details>`;
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.revision !== undefined) { revision = snapshots[Number(button.dataset.revision)]; selected = null; }
    if (button.dataset.question) selected = button.dataset.question;
    if (button.dataset.file) file = button.dataset.file;
    render();
  });
  render();
}

export function writeReportUI(runDir) {
  const read = name => { try { return JSON.parse(readFileSync(path.join(runDir, name), 'utf8')); } catch { return null; } };
  const comparison = read('comparison.json');
  const states = Object.fromEntries(Object.keys(comparison?.questions ?? {}).map(id => [id, /^[a-z][a-z0-9-]{0,79}$/.test(id) ? read(`questions/${id}/state.json`)?.state : null]));
  const data = {comparison, states, expected:read('report-expected.json'), ledger:read('scores.json'), runId:path.basename(runDir)};
  let error = '';
  try { error = readFileSync(path.join(runDir, 'validation-error.txt'), 'utf8'); } catch {}
  const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const passed = comparison?.passed && !error;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Jev diagnostics · ${passed ? 'Passed' : 'Failed'}</title><style>
  :root{font-family:ui-sans-serif,system-ui,sans-serif;color:#cdd5df;background:#14171c;font-size:13px}*{box-sizing:border-box}body{margin:0}button,a,summary{outline-offset:3px}button{font:inherit;color:inherit;cursor:pointer;text-align:left;border:0;background:transparent}button:hover{background:#252d38}button[aria-pressed=true]{background:#27364b;box-shadow:inset 2px 0 #81adf7}header{height:58px;display:flex;align-items:center;gap:24px;border-bottom:1px solid #303642;padding:0 24px}header b{font-size:17px;color:#fff}header span:last-child{margin-left:auto}.workspace{display:grid;grid-template-columns:220px minmax(300px,1fr) 370px;min-height:calc(100vh - 104px)}aside{background:#191d24;border-right:1px solid #303642;padding:22px 12px}.eyebrow,h3{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8c9aae;margin:0 0 16px}.eyebrow{padding:0 10px}#history button{width:100%;display:flex;gap:12px;padding:13px 10px;border-radius:4px}.node{color:#81adf7}small{display:block;font-size:11px;color:#96a3b5;margin-top:5px}#files{margin-top:14px}#files button{display:block;width:100%;padding:10px}aside p{color:#8795a8;font-size:12px;line-height:1.6;padding:0 10px}aside h3{margin:36px 10px 0}.center{min-width:0}.section-heading{padding:15px 20px;border-bottom:1px solid #303642;display:flex;gap:10px;justify-content:space-between;color:#96a3b5;font-size:12px}#revision{color:#dce6f4}#source{min-height:270px;padding:20px 0}.source-label{font:11px ui-monospace,monospace;color:#8e9bae;padding:12px 20px;overflow-wrap:anywhere}pre{font:12px/1.8 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:12px 20px;max-height:400px;overflow:auto}.removed{background:#39252b;color:#f2a6ad}.added{background:#1b332b;color:#a2dfb8}.diagnostic{display:flex;width:100%;gap:12px;padding:16px 20px;border-bottom:1px solid #282e38;align-items:center}.diagnostic b{text-transform:capitalize;font-weight:500}.diagnostic strong{margin-left:auto;font:14px ui-monospace,monospace}.pass{color:#94ddb2}.fail{color:#f0a0a4}.blocked{color:#d9bc7e}#detail{border-left:1px solid #303642;padding:0 22px 28px;min-width:0;background:#191d24}#detail>.section-heading{margin:0 -22px}h2{font-size:19px;font-weight:550;line-height:1.4;text-transform:capitalize;margin:24px 0}.metrics{display:flex;gap:30px;margin:24px 0}.metrics strong{display:block;font-size:22px;margin-top:6px}p{line-height:1.7}#detail h3{margin-top:26px}.location{display:block;padding:7px 0;color:#93bcff}dl{font-size:12px;line-height:1.6}dt{color:#8e9bae;margin-top:12px}dd{margin:3px 0;overflow-wrap:anywhere}details{border-top:1px solid #303642;margin-top:20px;padding-top:14px}summary{cursor:pointer}details pre{padding:15px 0}a{color:#93bcff}footer{display:flex;gap:22px;padding:15px 22px;border-top:1px solid #303642;font-size:11px;flex-wrap:wrap}.notice{color:#d9bc7e}.empty{padding:20px}.error{padding:20px;color:#f0a0a4}noscript{display:block;padding:20px}@media(max-width:1050px){.workspace{grid-template-columns:180px minmax(0,1fr)}#detail{grid-column:2;border-top:1px solid #303642}aside{grid-row:1 / span 2}}@media(max-width:600px){header{padding:0 14px;gap:12px;font-size:11px}.workspace{display:block}aside{padding:16px 10px}#history{display:flex;flex-wrap:wrap}#history button{width:auto}aside h3,#files,aside p{display:none}#detail{border-left:0}.diagnostic{padding:14px}footer{gap:12px}}
  </style></head><body><header><b>jev <span style="color:#8e9bae;font-weight:400">/ diagnostics</span></b><span>Recorded evaluation</span><span class="${passed ? 'pass' : 'fail'}">${passed ? '✓ Passed' : '✕ Failed'}</span></header>${error || !comparison ? `<div class="error">${escape(error || 'No valid comparison was produced. Inspect the raw artifacts below.')}</div>` : ''}<div class="workspace"><aside><div class="eyebrow">Snapshot history</div><nav id="history" aria-label="Snapshots"></nav><p>Fixture snapshots captured by the collectors. Git revisions were not recorded.</p><h3>Evidence</h3><nav id="files" aria-label="Evidence files"></nav></aside><main class="center"><div class="section-heading"><span id="file-title">Evidence</span><strong id="revision"></strong></div><section id="source" aria-label="Recorded evidence comparison"></section><div class="section-heading">Diagnostics <span>Selected snapshot</span></div><section id="diagnostics" aria-label="Diagnostics"></section></main><section id="detail" aria-label="Selected evaluation"></section></div><noscript>Enable JavaScript for snapshot navigation, or open the JSON artifacts below.</noscript><footer>${['comparison.json','report-expected.json','report-observed.json','playwright-report.json'].map(f=>`<a href="${f}">${f}</a>`).join('')}</footer><script>(${viewer.toString()})(${JSON.stringify(data).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029')});</script></body></html>`;
  const destination = path.join(runDir, 'index.html');
  writeFileSync(destination, html);
  return destination;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node report-ui.mjs RUN_DIRECTORY');
  console.log(writeReportUI(path.resolve(process.argv[2])));
}
