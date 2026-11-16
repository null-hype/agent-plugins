# agent-plugins.org: what it is and what delta-zero would need

Checked 2026-11-16 by fetching the site and its pages, not just the homepage.

## What it is

A **specification**, not a registry or a directory. https://agent-plugins.org describes itself as
"an open, vendor-neutral standard for packaging reusable components into portable plugins"
(version 1.0.0 published; 1.1.0, which adds portable hooks, is a working draft). Its
technical steering committee lists maintainers from Amazon, Cursor, Microsoft, OpenAI and Vercel.

- Spec text: https://agent-plugins.org/specification (repo: https://github.com/agentplugins/agent-plugins-spec)
- Schemas: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json and `.../mcp.schema.json`
- Example plugin: https://github.com/agentplugins/agent-plugins-example
- Clients that load plugins: https://agent-plugins.org/compatible-clients (VS Code, Cursor, GitHub Copilot, ChatGPT and Codex, Kiro, and others; each loads Agent Skills and MCP servers)
- Discussion: https://github.com/agentplugins/agent-plugins-spec/discussions

## What a plugin must contain

A directory (not an archive) with:

1. `plugin.json` at the root, required. https://agent-plugins.org/plugin-authors/manifest
   - `$schema`: `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` (required)
   - `name` (required): 1-64 chars, lowercase letters, digits, hyphens, periods; starts and ends alphanumeric; no `--` or `..`. `delta-zero` is valid.
   - Optional: `version`, `description`, `author{name,email,url}`, `homepage`, `repository`, `license`, `keywords`, `extensions`.
   - The schema is closed; unknown top-level fields are reported and ignored. Client-specific data goes under `extensions`.
2. Optional components in fixed places:
   - `skills/<name>/SKILL.md`, in the Agent Skills format (https://agentskills.io/specification, https://agent-plugins.org/plugin-authors/skills). Only immediate children of `skills/` are discovered.
   - `mcp.json`, with `$schema` `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` and `mcpServers` (stdio, streamable-http, or legacy sse). https://agent-plugins.org/plugin-authors/mcp-servers
   - `<reverse.domain.client>/...` for client-specific behaviour.
3. Everything must resolve inside the plugin root; stdio `command` is one executable token or a `./` path.

Nothing else is portable. Hooks are only in the 1.1.0 draft. Installation, distribution and permissions are left to each client.

## How a plugin gets listed

The site gives no format and no process for this. It lists **clients**, not plugins, and the spec
says plugins deliberately avoid "registry-fetched bundles". Distribution is client-managed (a git
repo a client can install from). So "listing on agent-plugins.org" is not something the site offers;
the only open channel is the spec repo's GitHub Discussions. A repo that validates is the whole bar.

## What delta-zero would need to qualify

delta-zero is a Python script plus a Neovim/Witness setup today, so it has none of these yet:

- `plugin.json` at the repo root (or in a subdirectory shipped as the plugin), with `$schema` and `"name": "delta-zero"`.
- At least one component, realistically `skills/delta-zero/SKILL.md` (frontmatter `name`, `description`) telling an agent to run `pkl_thread.py` on a thread and read the findings. `scripts/` inside the skill may hold `pkl_thread.py` and `Thread.pkl`.
- Or an `mcp.json` with a stdio server, which does not exist and would be new work.
- The skill needs Python 3 and Pkl on the host; the plugin format has no way to declare or install dependencies.
- An editor-diagnostics view (Witness LSP) is not a skill or MCP server, so it stays outside the portable core.

Not verified: whether any client rejects or accepts such a plugin (no validator was run), and
whether the example repo's layout has extra conventions beyond the docs.
