
# Proton Drive CLI (protondrive)

Installs a pinned, checksum-verified Proton Drive CLI (proton-drive) that keeps its session in Unix pass (GPG) instead of a desktop keyring, so it works in a headless container. Sign-in happens at runtime with `proton-drive auth login`.

## Example Usage

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/protondrive:1": {}
}
```

## Options

| Options Id | Description | Type | Default Value |
|-----|-----|-----|-----|




---

_Note: This file was auto-generated from the [devcontainer-feature.json](https://github.com/null-hype/agent-plugins/blob/main/src/protondrive/devcontainer-feature.json).  Add additional notes to a `NOTES.md`._
