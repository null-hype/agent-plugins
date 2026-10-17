// node gen.mjs <dir> [names...]  — one Stitch project, one screen per design system.
import fs from "fs"; import path from "path";
const dir = process.argv[2]; const names = process.argv.slice(3);
const { stitch } = await import("/workspaces/agent-plugins/tutorial-app/node_modules/@google/stitch-sdk/dist/src/index.js");
const metaPath = path.join(dir, "project.json");
let projectId = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath)).projectId : null;
if (!projectId) {
  const p = await stitch.callTool("create_project", { title: "Tidelands — design variations" });
  projectId = p.name.replace("projects/", "");
  fs.writeFileSync(metaPath, JSON.stringify({ projectId }, null, 2));
  console.log("created project", projectId);
}
const project = stitch.project(projectId);
const structure = fs.readFileSync(path.join(dir, "structure.md"), "utf8");
await Promise.all(names.map(async (n) => {
  const prompt = fs.readFileSync(path.join(dir, `${n}.prompt.md`), "utf8") + "\n" + structure;
  const t0 = Date.now();
  try {
    const screen = await project.generate(prompt, "DESKTOP");
    const html = await (await fetch(await screen.getHtml())).text();
    fs.writeFileSync(path.join(dir, `${n}.html`), html);
    const img = await screen.getImage();
    if (img) fs.writeFileSync(path.join(dir, `${n}.png`), Buffer.from(await (await fetch(img)).arrayBuffer()));
    fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify({ projectId, screenId: screen.id }, null, 2));
    console.log(n, "ok", screen.id, ((Date.now() - t0) / 1000).toFixed(0) + "s");
  } catch (e) { console.log(n, "FAILED", e.message); }
}));
