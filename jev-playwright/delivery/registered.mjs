import { execFileSync } from 'node:child_process';

// What the planner registered before the run, read as the judge, who can read
// the planner's journal and not change it: its `plan` field, and when Pass
// last saw the journal changed, as Predicted.pkl takes them. The judge sees
// the journal as a share of that one item, and the share says its role.
//
//   node delivery/registered.mjs > registered.json
const dir = process.env.PASS_SESSION_JUDGE;
const env = { ...process.env, PROTON_PASS_AGENT_REASON: 'read the predictions the planner registered before the delivery run', ...(dir && { PROTON_PASS_SESSION_DIR: dir, PROTON_PASS_KEY_PROVIDER: 'fs' }) };
const pass = (...args) => JSON.parse(execFileSync('pass-cli', [...args, '--output', 'json'], { encoding: 'utf8', env }));
const shared = pass('share', 'list').shares.filter((s) => s.share_type === 'Item' && s.name === 'journal');
if (shared.length !== 1) throw new Error(`the judge sees ${shared.length} shared journals, not the planner's one`);
const [share] = shared;
const { item } = pass('item', 'view', '--share-id', share.id, '--item-title', 'journal');
const field = item.content.content.Custom.sections.flatMap((s) => s.section_fields).find((f) => f.name === 'plan');
const text = field?.content.Text;
if (!text) throw new Error('jev-planner/journal registers no plan');
// Pass gives UTC without a zone.
const written = new Date(`${item.modify_time}Z`).toISOString();
process.stdout.write(JSON.stringify({ item: 'jev-planner/journal', role: share.share_role, written, plan: JSON.parse(text) }, null, 2) + '\n');
