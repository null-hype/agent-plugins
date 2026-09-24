---
name: storybook-mcp
description: Use this workspace's Storybook 10.6 MCP server and project-specific Storybook skills when inspecting, writing, or testing UI components and stories.
---

# Storybook in this workspace

The Storybook project is `tutorial-app`, and its dev server exposes MCP at `http://127.0.0.1:6006/mcp`. Start it with `npm run storybook -- --no-open` from `tutorial-app` when a task needs live stories or MCP tools. The repository's `.codex/config.toml` registers that endpoint for Codex.

Before changing components or stories, run `./node_modules/.bin/storybook skills write-story` from `tutorial-app` for the installed Storybook version's current conventions. Run `./node_modules/.bin/storybook skills stories` for Storybook's broader UI workflow. Use `./node_modules/.bin/storybook tools --help` to discover the current CLI tools when live MCP access is unavailable.

Use the connected Storybook MCP tools or Storybook CLI to find real story IDs, inspect component documentation, and test affected stories. Do not infer story IDs from filenames. Keep the dev server running during a task that needs MCP; report clearly if the server cannot be started or connected.
