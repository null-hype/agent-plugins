
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

## Usage

Run the installed `tailscale-up` bin via `postStartCommand` so the tailnet join happens (idempotently) on every container start:

```json
"postStartCommand": "tailscale-up"
```

`tailscale-up` requires `pass-cli` to be installed and either already logged in, or `PROTON_PASS_PERSONAL_ACCESS_TOKEN` set in the environment so it can log in itself. It also requires `NET_ADMIN`/`NET_RAW` capabilities and `/dev/net/tun` to be available to the container (see `runArgs` in the example `devcontainer.json` below).

```json
"runArgs": [
    "--cap-add=NET_ADMIN",
    "--cap-add=NET_RAW",
    "--device=/dev/net/tun"
]
```

---

_Note: This file was auto-generated from the [devcontainer-feature.json](https://github.com/null-hype/agent-plugins/blob/main/src/tailscale/devcontainer-feature.json).  Add additional notes to a `NOTES.md`._
