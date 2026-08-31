
# Cloudflared Tunnel (cloudflared-tunnel)

Installs cloudflared and a 'start-cloudflared-tunnel' bin that idempotently starts a Cloudflare Tunnel connector (pass-cli-resolved token) in the background, fronting a local port with a public hostname.

## Example Usage

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/cloudflared-tunnel:1": {
        "hostname": "agent.tidelands.dev",
        "localPort": "8080",
        "tunnelId": "",
        "tokenSecretPath": "development/cloudflare/CLOUDFLARE_TUNNEL_TOKEN"
    }
}
```

```bash
$ start-cloudflared-tunnel

cloudflared-tunnel: started
```

Running it again while the connector is already up is a no-op:

```bash
$ start-cloudflared-tunnel

cloudflared-tunnel: already running
```

## Options

| Options Id | Description | Type | Default Value |
|-----|-----|-----|-----|
| hostname | Public hostname the tunnel routes to this container (informational: the actual routing is configured server-side on the tunnel itself; this is used only in the installed bin's log output and comments). | string | agent.tidelands.dev |
| localPort | Local port the tunnel fronts (informational, same caveat as 'hostname' - the tunnel's ingress config, provisioned separately via the Cloudflare API, is what actually routes to it). | string | 8080 |
| tunnelId | Cloudflare Tunnel id, e.g. the '<tunnel-id>' in '<tunnel-id>.cfargotunnel.com' (informational only - the running connector's identity actually comes from the resolved CLOUDFLARE_TUNNEL_TOKEN, not this value). Leave blank if unknown. | string | - |
| tokenSecretPath | pass-cli path resolving to the Cloudflare Tunnel connector token (CLOUDFLARE_TUNNEL_TOKEN). | string | development/cloudflare/CLOUDFLARE_TUNNEL_TOKEN |

## Notes

- The tunnel itself (its id, the ingress config routing `hostname` -> `http://localhost:<localPort>`, and the DNS CNAME to `<tunnelId>.cfargotunnel.com`) must already be provisioned separately, e.g. via the Cloudflare API or dashboard. This feature only installs the `cloudflared` connector and a bin to run it.
- `start-cloudflared-tunnel` resolves `CLOUDFLARE_TUNNEL_TOKEN` from Pass via [`pass-cli`](../pass-cli) at runtime (path set by `tokenSecretPath`), so `pass-cli` must be installed and logged in before it's called. It does not run automatically on container start - add it to a postStartCommand/postAttachCommand or call it yourself.
- Idempotent (checks `pgrep -f "cloudflared tunnel run"` before starting) and backgrounded (`nohup` + `disown`), so the connector survives the session that started it.

---

_Note: This file was auto-generated from the [devcontainer-feature.json](https://github.com/null-hype/agent-plugins/blob/main/src/cloudflared-tunnel/devcontainer-feature.json).  Add additional notes to a `NOTES.md`._
