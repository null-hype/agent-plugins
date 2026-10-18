
# My Favorite Color (pass-cli)

A feature to remind you of your favorite color

## Example Usage

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/pass-cli:1": {}
}
```

## Options

| Options Id | Description | Type | Default Value |
|-----|-----|-----|-----|
| favorite | Choose your favorite color. | string | red |
| model | Model the 'color' bin uses for its pass-cli-authenticated claude call (see src/pass-cli/install.sh). | string | haiku |
| effort | Effort level the 'color' bin uses for its pass-cli-authenticated claude call. | string | low |
| tag | restic snapshot tag the 'color' bin uses when it backs up ~/.claude. | string | color |



---

_Note: This file was auto-generated from the [devcontainer-feature.json](https://github.com/null-hype/agent-plugins/blob/main/src/pass-cli/devcontainer-feature.json).  Add additional notes to a `NOTES.md`._
