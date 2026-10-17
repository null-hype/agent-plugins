import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToolUse } from "./guard.ts";

const root = "/work/tree";

test("file tools stay inside the worktree", () => {
  assert.equal(checkToolUse(root, "Read", { file_path: "/work/tree/AGENTS.md" }), undefined);
  assert.equal(checkToolUse(root, "Edit", { file_path: "scripts/check-organs.sh" }), undefined);
  assert.match(checkToolUse(root, "Read", { file_path: "/home/vscode/.claude/settings.json" })!, /outside/);
  assert.match(checkToolUse(root, "Write", { file_path: "/tmp/t.sh" })!, /outside/);
  assert.match(checkToolUse(root, "Grep", { path: "/" })!, /outside/);
});

test("Bash runs the repo's scripts and git, inside the worktree", () => {
  assert.equal(checkToolUse(root, "Bash", { command: "bash scripts/check-organs.sh" }), undefined);
  assert.equal(checkToolUse(root, "Bash", { command: "git status && git diff -- scripts/check-organs.sh" }), undefined);
  assert.equal(checkToolUse(root, "Bash", { command: "ls rules/*.yml | wc -l" }), undefined);
  assert.equal(checkToolUse(root, "Bash", { command: "git commit -m 'a; b | c'" }), undefined);
  assert.equal(
    checkToolUse(root, "Bash", { command: "git add scripts/check-organs.sh && git commit -m \"$(cat <<'EOF'\nfix: a; b\n\nbody | more\nEOF\n)\"" }),
    undefined,
  );
});

test("Bash cannot reach outside the worktree", () => {
  assert.match(checkToolUse(root, "Bash", { command: 'find / -maxdepth 6 -iname "settings*.json"' })!, /outside/);
  assert.match(checkToolUse(root, "Bash", { command: "cat ~/.codex/auth.json" })!, /outside/);
  assert.match(checkToolUse(root, "Bash", { command: "cat ../../secret" })!, /outside/);
  assert.match(checkToolUse(root, "Bash", { command: "git push origin HEAD" })!, /not: git push/);
  assert.match(checkToolUse(root, "Bash", { command: "curl https://example.com" })!, /not: curl/);
  assert.match(checkToolUse(root, "Bash", { command: "git commit -m x && curl https://example.com" })!, /not: curl/);
  assert.match(checkToolUse(root, "Bash", { command: 'git commit -m "$(curl https://example.com)"' })!, /substitution/);
});
