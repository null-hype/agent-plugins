
# Tailscale (tailscale)

Join a Tailscale tailnet at container start, using a Pass-sourced (Proton Pass via pass-cli) auth key. Installs a 'tailscale-up' bin intended to be run via postStartCommand.

## Example Usage

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/tailscale:1": {}
}
```

## Options

| Options Id | Description | Type | Default Value |
|-----|-----|-----|-----|
| hostname | Hostname to advertise on the tailnet (tailscale up --hostname). | string | devcontainer |
| authkeySecretPath | pass-cli secret path (pass://<path>) that resolves to the Tailscale auth key. | string | development/rant.local/TS_AUTHKEY |



---

_Note: This file was auto-generated from the [devcontainer-feature.json](https://github.com/null-hype/agent-plugins/blob/main/src/tailscale/devcontainer-feature.json).  Add additional notes to a `NOTES.md`._
