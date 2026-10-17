import path from "node:path";
import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

/**
 * PreToolUse policy for worktree mode: every tool call stays inside the
 * session's worktree. Permission rules alone did not hold -- dontAsk still
 * auto-approves read-only Bash (`find /`, `cat ~/...`) and Read on any path,
 * seen live on JIN-144 -- so this hook decides every call itself.
 *
 * - Read/Edit/Write: file_path must resolve inside the worktree.
 * - Glob/Grep: path (default: the worktree) must resolve inside it.
 * - Bash: each command in a `&&`/`||`/`;`/`|` chain must start with an
 *   allowed program, and no word may point outside the worktree (an
 *   absolute path elsewhere, `~`, `$HOME`, or a `..` segment).
 */
const BASH_ALLOWED = [
  /^git (status|diff|log|show|add|commit|rev-parse|ls-files)\b/,
  /^(bash|sh) scripts\//,
  /^\.\/scripts\//,
  /^(npm test|npx vitest|npx tsc)\b/,
  /^(ls|cat|head|tail|wc|grep|rg|find|sed -n|awk|sort|uniq|diff|echo|printf|pwd|test|\[)\b/,
];
const ALLOWED_ABSOLUTE = new Set(["/dev/null"]);

function inside(root: string, p: string): boolean {
  const rel = path.relative(root, path.resolve(root, p));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function checkToolUse(root: string, tool: string, input: Record<string, unknown>): string | undefined {
  switch (tool) {
    case "Read":
    case "Edit":
    case "Write": {
      const p = String(input.file_path ?? "");
      return inside(root, p) ? undefined : `${tool} is limited to the worktree; ${p} is outside it`;
    }
    case "Glob":
    case "Grep": {
      const p = String(input.path ?? ".");
      return inside(root, p) ? undefined : `${tool} is limited to the worktree; ${p} is outside it`;
    }
    case "Bash": {
      const command = String(input.command ?? "");
      for (const word of command.split(/[\s'"=()<>|;&]+/)) {
        if (word.startsWith("~") || word.includes("$HOME") || word.split("/").includes("..")) {
          return `Bash is limited to the worktree; "${word}" points outside it`;
        }
        if (word.startsWith("/") && !ALLOWED_ABSOLUTE.has(word) && !inside(root, word)) {
          return `Bash is limited to the worktree; ${word} is outside it`;
        }
      }
      // Quoted text (e.g. a commit message, including the usual
      // "$(cat <<'EOF' ... EOF)" form) is data: drop it before splitting the
      // chain. Any other command substitution could run anything.
      // Single quotes are inert; double quotes still expand $(...), so the
      // substitution check runs before those are dropped.
      const unquoted = command
        .replace(/"\$\(cat <<'?(\w+)'?\n[\s\S]*?\n\1\n?\s*\)"/g, "''")
        .replace(/'[^']*'/g, "''");
      if (/\$\(|`/.test(unquoted)) return `Bash does not allow command substitution: ${command}`;
      const code = unquoted.replace(/"(?:[^"\\]|\\.)*"/g, "''");
      for (const part of code.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean)) {
        if (!BASH_ALLOWED.some((re) => re.test(part))) {
          return `Bash allows git (status/diff/log/show/add/commit), the repo's scripts and tests, and read-only file commands; not: ${part}`;
        }
      }
      return undefined;
    }
    default:
      return `${tool} is not available in this session`;
  }
}

export function worktreeGuard(root: string): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const reason = checkToolUse(root, input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: reason ? "deny" : "allow",
        permissionDecisionReason: reason ?? "inside the session worktree",
      },
    };
  };
}
