// node evolve.mjs <dir> <gen> <parentName> <promptFile> <range> <count> [tagPrefix]
// Breeds `count` Stitch variants of a parent screen; saves <gen>-<tag>.{html,png} and appends lineage.json.
import fs from "fs"; import path from "path";
const [dir, gen, parent, promptFile, range, count, prefix = ""] = process.argv.slice(2);
const { stitch, Screen } = await import("/workspaces/agent-plugins/tutorial-app/node_modules/@google/stitch-sdk/dist/src/index.js");
const { projectId } = JSON.parse(fs.readFileSync(path.join(dir, "project.json")));
const parentMeta = JSON.parse(fs.readFileSync(path.join(dir, `${parent}.json`)));
const prompt = fs.readFileSync(path.resolve(dir, promptFile), "utf8");
const t0 = Date.now();
const raw = await stitch.callTool("generate_variants", {
  projectId, selectedScreenIds: [parentMeta.screenId], prompt, deviceType: "DESKTOP",
  variantOptions: { variantCount: +count, creativeRange: range },
});
const kids = (raw.outputComponents || []).flatMap((c) => c?.design?.screens || [])
  .map((d) => new Screen(stitch, { ...d, projectId }));
const lineagePath = path.join(dir, "lineage.json");
const lineage = fs.existsSync(lineagePath) ? JSON.parse(fs.readFileSync(lineagePath)) : [];
let i = 0;
for (const k of kids) {
  const name = `${gen}-${prefix}${String.fromCharCode(97 + i++)}`;
  const html = await (await fetch(await k.getHtml())).text();
  fs.writeFileSync(path.join(dir, `${name}.html`), html);
  const img = await k.getImage();
  if (img) fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(await (await fetch(img)).arrayBuffer()));
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ projectId, screenId: k.id }, null, 2));
  lineage.push({ name, parent, range, prompt: promptFile, screenId: k.id });
  console.log(name, "ok", k.id);
}
fs.writeFileSync(lineagePath, JSON.stringify(lineage, null, 2));
console.log(`${kids.length} variants in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
