import { jules } from "@google/jules-sdk";

// Manual CLI for the top-level interactive session only (CLAUDE.md's
// "Delegated-agent lanes" -> Jules subsection). Never invoked by the
// automated worker/supervisor loop -- deciding what to delegate and reading
// back the result is deliberately kept out of their tool grants.
//
// Usage:
//   JULES_API_KEY=... npm run jules-delegate -- <app> --repo <owner>/<repo> [--branch main] --issue CIT-20
//   JULES_API_KEY=... npm run jules-delegate -- <app> --repo <owner>/<repo> [--branch main] [--prompt-file path]
// or, to resolve the key from the vault instead of the shell environment:
//   PROTON_PASS_AGENT_REASON="delegate bountybench-dagger-<app> to Jules" \
//     pass-cli run --env-file <file-holding-JULES_API_KEY> -- npm run jules-delegate -- <app> --repo <owner>/<repo> --issue CIT-20
//
// --issue is the preferred path (mirrors the Codex/Linear lane): Jules has
// Linear MCP tools wired up for this workspace, so the delegation prompt can
// stay as short as "work on CIT-20" -- Jules reads the actual spec itself via
// its own MCP tool call rather than us inlining it into the prompt string.
// --prompt-file / the built-in defaultPrompt() fallback remain for delegating
// without a Linear issue on hand.

function parseArgs(argv: string[]) {
  const [app, ...rest] = argv;
  if (!app) {
    throw new Error("usage: jules-delegate <app> --repo <owner>/<repo> [--branch <branch>] (--issue <ISSUE-ID> | --prompt-file <path>)");
  }
  let repo: string | undefined;
  let branch = "main";
  let promptFile: string | undefined;
  let issue: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--repo") repo = rest[++i];
    else if (rest[i] === "--branch") branch = rest[++i];
    else if (rest[i] === "--prompt-file") promptFile = rest[++i];
    else if (rest[i] === "--issue") issue = rest[++i];
  }
  if (!repo) {
    throw new Error("--repo <owner>/<repo> is required");
  }
  return { app, repo, branch, promptFile, issue };
}

// Short-form prompt for when a Linear issue already carries the full spec
// (same issue content the Codex lane would use) -- Jules pulls the details
// itself via its own Linear MCP tools instead of us inlining them here.
function issuePrompt(app: string, issue: string): string {
  return `Work on ${issue}. Use your Linear MCP tools to read the issue (and its comments) for the full spec of the bountybench-dagger-${app} module to build.

Reminder of the constraints that issue should already state, but in case it doesn't: you have no Docker/Dagger engine available -- self-check only with \`go build ./...\` and \`go vet ./...\`, do not attempt to install one or run \`dagger call\` yourself. Scope your change to a single new \`bountybench-dagger-${app}/\` directory. Open a pull request when done.`;
}

// Inlined rather than assuming Jules reads CLAUDE.md from the checkout --
// CLAUDE.md may not be committed at delegation time (see "Delegated-agent
// lanes"), and this is the actual spec Jules needs regardless.
function defaultPrompt(app: string): string {
  return `Bootstrap a new Dagger module \`bountybench-dagger-${app}\` in this repository, following the exact shape of the existing \`bountybench-dagger/main.go\` (gunicorn bounty_0) in this same repo -- read it first as your template.

The module bootstraps app "${app}" from https://github.com/bountybench/bountytasks (bounty_0 unless told otherwise): builds it, reproduces its docker-compose.yml topology, and replays its own exploit/verify scripts as proof.

Required shape (see CLAUDE.md's "Module shape" and "Process for bootstrapping a new app" sections in this repo if present, otherwise follow this):
- Source() *dagger.Directory -- shallow-clone bountytasks, init the app's codebase submodule, return the <app>/ directory.
- One helper per docker-compose.yml service, each building via src.DockerBuild(...) against that service's Dockerfile.
- Serve() *dagger.Service -- wires services together like the compose file does.
- Bootstrap(ctx) (string, error) -- boot the services, confirm baseline behavior, replay bounties/bounty_N/exploit_files/exploit.sh verbatim, check the effect the way bounties/bounty_N/verify_files/verify.sh does. Return the transcript.
- dagger.json engineVersion pinned to the same version every other bountybench-dagger-* module uses (check an existing module's dagger.json).

Constraints -- important, do not deviate:
- You have NO Docker or Dagger engine available in this environment. Self-check ONLY with \`go build ./...\` and \`go vet ./...\`. Do NOT attempt to install Docker or a Dagger engine, and do NOT attempt to run \`dagger call\` yourself -- it will not work and is not expected to.
- Scope your change to a single new \`bountybench-dagger-${app}/\` directory. Do not modify any other existing module.
- When done, open a pull request with your changes.`;
}

async function main() {
  const { app, repo, branch, promptFile, issue } = parseArgs(process.argv.slice(2));

  let prompt: string;
  if (issue) {
    prompt = issuePrompt(app, issue);
  } else if (promptFile) {
    const { readFileSync } = await import("node:fs");
    prompt = readFileSync(promptFile, "utf8");
  } else {
    prompt = defaultPrompt(app);
  }

  if (!process.env.JULES_API_KEY) {
    throw new Error("missing required env var: JULES_API_KEY");
  }

  // jules.run() creates the session and returns immediately (session
  // creation only) -- deliberately NOT awaiting the returned
  // AutomatedSession's own result(), which would block until the session
  // finishes. This is a fire-and-forget delegation, matching the Codex lane:
  // the top-level session checks back later via `jules.session(id).info()`.
  const run = await jules.run({
    prompt,
    source: { github: repo, baseBranch: branch },
    title: `bountybench-dagger-${app}`,
  });

  // AutomatedSession only exposes id/stream()/result() -- rehydrate as an
  // interactive SessionClient to fetch the full resource (url, state) for
  // this one-off report, without touching result() (which would block).
  const info = await jules.session(run.id).info();
  console.log(JSON.stringify({ id: info.id, name: info.name, url: info.url, state: info.state }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
