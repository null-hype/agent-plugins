import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseRef } from "./workspace.ts";

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
}

// An origin with main, and a workspace cloned from it before the issue's
// branch was pushed, like the agent's checkout on the host.
function staleWorkspace(): { origin: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), "workspace-test-"));
  const origin = join(root, "origin");
  const workspace = join(root, "workspace");
  execFileSync("git", ["init", "-q", "-b", "main", origin]);
  git(origin, "commit", "-q", "--allow-empty", "-m", "main");
  execFileSync("git", ["clone", "-q", origin, workspace]);
  git(origin, "branch", "cit-1-finding");
  return { origin, workspace };
}

test("baseRef fetches and picks the issue's branch once it is on origin", async () => {
  const { workspace } = staleWorkspace();
  assert.equal(await baseRef(workspace, "cit-1-finding"), "origin/cit-1-finding");
});

test("baseRef falls back to origin/main", async () => {
  const { workspace } = staleWorkspace();
  assert.equal(await baseRef(workspace, "cit-2-not-pushed"), "origin/main");
  assert.equal(await baseRef(workspace, undefined), "origin/main");
});

test("baseRef survives a failed fetch", async () => {
  const { workspace } = staleWorkspace();
  git(workspace, "remote", "set-url", "origin", "/nonexistent");
  assert.equal(await baseRef(workspace, "cit-1-finding"), "origin/main");
});
