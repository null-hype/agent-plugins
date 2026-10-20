import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncWorkspace } from "./workspace.ts";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();
}

// A workspace cloned onto a side branch, after which origin's main moved on
// and the issue's branch was pushed, like the agent's checkout on the host.
// It also has a locally modified file, as generate-env-files.sh leaves one.
function staleWorkspace(): { origin: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), "workspace-test-"));
  const origin = join(root, "origin");
  const workspace = join(root, "workspace");
  execFileSync("git", ["init", "-q", "-b", "main", origin]);
  writeFileSync(join(origin, "generated.env"), "KEY=old\n");
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "main");
  git(origin, "branch", "side");
  execFileSync("git", ["clone", "-q", "-b", "side", origin, workspace]);
  writeFileSync(join(workspace, "generated.env"), "KEY=local\n");
  git(origin, "commit", "-q", "--allow-empty", "-m", "main moves on");
  git(origin, "branch", "cit-1-finding");
  return { origin, workspace };
}

test("syncWorkspace moves HEAD to the fetched origin/main and keeps local changes", async () => {
  const { origin, workspace } = staleWorkspace();
  await syncWorkspace(workspace, undefined);
  assert.equal(git(workspace, "rev-parse", "HEAD"), git(origin, "rev-parse", "main"));
  assert.equal(readFileSync(join(workspace, "generated.env"), "utf8"), "KEY=local\n");
});

test("syncWorkspace returns the issue's branch only once it is on origin", async () => {
  const { workspace } = staleWorkspace();
  assert.equal(await syncWorkspace(workspace, "cit-1-finding"), "origin/cit-1-finding");
  assert.equal(await syncWorkspace(workspace, "cit-2-not-pushed"), undefined);
  assert.equal(await syncWorkspace(workspace, undefined), undefined);
});

test("syncWorkspace survives a failed fetch", async () => {
  const { workspace } = staleWorkspace();
  git(workspace, "remote", "set-url", "origin", "/nonexistent");
  assert.equal(await syncWorkspace(workspace, "cit-1-finding"), undefined);
});
