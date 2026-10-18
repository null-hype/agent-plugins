# Toolbox (CIT-430 spike)

The start of an MCP server on Render that the Linear Agent will use to create
and manage DevPod workspaces on one GCE host. For now it only answers how the
Linear Agent connects to a custom MCP server:

- **Auth.** Each request logs its path and auth scheme (never the token), and
  any `/.well-known/*` OAuth discovery attempt. With `TOOLBOX_TOKEN` set, `/mcp`
  needs `Authorization: Bearer <token>`. A 401 points at
  `/.well-known/oauth-protected-resource`, which lists no authorization
  server.
- **Time.** `slow_ping(seconds)` logs when a caller gives up waiting.

Tools: `ping`, `slow_ping`. Endpoint: `/mcp` (streamable HTTP). Health: `/healthz`.

```sh
docker build -t toolbox . && docker run --rm -p 8080:8080 -e TOOLBOX_TOKEN=dev toolbox
```

The Docker build runs the tests.
