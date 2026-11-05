import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The OpenRouter runtime's only tools come from `container-use stdio`. This
// puts a fake `container-use` on PATH that speaks just enough MCP (JSON-RPC
// over stdio) to check the bridge for real: it is started in the workspace
// checkout, its tools reach the model as @openrouter/agent tools with their
// schemas, and calls round-trip with errors kept as errors.
const dir = mkdtempSync(join(tmpdir(), "mcp-bridge-"));
const workspace = mkdtempSync(join(tmpdir(), "mcp-workspace-"));
const fake = join(dir, "container-use");
writeFileSync(
  fake,
  `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(join(dir, "started"))}, process.cwd() + " " + process.argv.slice(2).join(" "));
let buf = "";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id === undefined) continue;
    if (m.method === "initialize") {
      send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-container-use", version: "0" } } });
    } else if (m.method === "tools/list") {
      send({ jsonrpc: "2.0", id: m.id, result: { tools: [
        { name: "environment_create", description: "Create an environment", inputSchema: { type: "object", properties: { environment_source: { type: "string" }, title: { type: "string" } }, required: ["environment_source", "title"] } },
        { name: "environment_run_cmd", description: "Run a command", inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
      ] } });
    } else if (m.method === "tools/call") {
      const { name, arguments: args } = m.params;
      if (name === "environment_run_cmd") {
        send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "exit 2: " + args.command }], isError: true } });
      } else {
        send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "created amazed-bluebird from " + args.environment_source }] } });
      }
    } else {
      send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no " + m.method } });
    }
  }
});
`,
);
chmodSync(fake, 0o755);

test("container-use's tools are bridged into the OpenRouter tool loop", async () => {
  process.env.PATH = `${dir}:${process.env.PATH}`;
  process.env.DEVENV_BASE_WORKSPACE_DIR = workspace;
  // Imported here so claude.ts reads the workspace above when it loads.
  const { connectContainerUse } = await import("./openrouter.ts");
  const mcp = await connectContainerUse();
  try {
    assert.equal(readFileSync(join(dir, "started"), "utf8"), `${workspace} stdio`, "started as `container-use stdio` in the checkout");
    const names = mcp.tools.map((t) => (t as { function: { name: string } }).function.name);
    assert.deepEqual(names, ["environment_create", "environment_run_cmd"]);

    const [create, run] = mcp.tools as unknown as Array<{
      function: { inputSchema: { safeParse(v: unknown): { success: boolean } }; execute(args: unknown): Promise<string> };
    }>;
    assert.equal(create.function.inputSchema.safeParse({ environment_source: workspace }).success, false, "required fields are enforced");
    assert.equal(
      await create.function.execute({ environment_source: workspace, title: "fix" }),
      `created amazed-bluebird from ${workspace}`,
    );
    assert.equal(await run.function.execute({ command: "npm test" }), "Error: exit 2: npm test");
  } finally {
    await mcp.close();
  }
});
