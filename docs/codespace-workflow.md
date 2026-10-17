# Creating and destroying codespaces from Actions

`.github/workflows/codespace.yml` creates, destroys, or lists GitHub
Codespaces for this repository. It runs on `workflow_dispatch` and can also be
called from another workflow (`workflow_call`).

## Token

The default `GITHUB_TOKEN` cannot manage codespaces, so the workflow resolves
a personal access token from Proton Pass at
**`pass://infra/github.com/GITHUB_TOKEN`**, the same way
`storybook-preview.yml` resolves its Netlify token: `pass-cli login` with the
existing **`PROTON_PASS_PERSONAL_ACCESS_TOKEN`** repository secret, then
`pass-cli run --env-file`. The resolved token is masked and handed to the later
`gh` steps as `GH_TOKEN`. No new repository secret is needed.

Codespaces belong to a user, so every codespace this workflow creates is owned
by, and billed to, the account that owns that token. The token needs:

- **Classic PAT**: scopes `codespace` and `repo`.
- **Fine-grained PAT**: resource owner `null-hype`, repository access including
  `null-hype/agent-plugins`, with repository permissions
  **Codespaces: Read and write**, **Contents: Read**, and **Metadata: Read**.

## Inputs

| Input | Used by | Default | Notes |
|---|---|---|---|
| `action` | all | `create` | `create`, `destroy`, or `list` |
| `branch` | create, destroy | branch the run is on | Destroy uses it only when `name` is empty |
| `machine` | create | `basicLinux32gb` | `basicLinux32gb` (2 core), `standardLinux32gb` (4), `premiumLinux` (8), `largePremiumLinux` (16) |
| `devcontainer_path` | create | `.devcontainer/devcontainer.json` | Or `.devcontainer/internal/devcontainer.json` |
| `display_name` | create | empty | 48 characters or less |
| `idle_timeout` | create | `30m` | Inactivity before the codespace stops |
| `retention_period` | create | empty | Time after stopping before auto-delete, max `720h` |
| `name` | destroy | empty | Empty destroys every codespace of this repo on `branch` |
| `force` | destroy | `false` | Delete even with unpushed or uncommitted changes |

`devcontainer_path` and `machine` are always passed because `gh codespace
create` otherwise prompts interactively, which fails in CI. The repo has two
devcontainer configs, so the path has to be chosen explicitly.

The created codespace's name is printed in the run summary and exposed as the
`name` output for `workflow_call` callers.

## Examples

```bash
# Create from main on a 4-core machine
gh workflow run codespace.yml -f action=create -f branch=main -f machine=standardLinux32gb

# Destroy one codespace by name
gh workflow run codespace.yml -f action=destroy -f name=<codespace-name>

# Destroy every codespace on a branch
gh workflow run codespace.yml -f action=destroy -f branch=my-feature

# List
gh workflow run codespace.yml -f action=list
```

From another workflow, creating a codespace for a PR branch and destroying it
when the PR closes:

```yaml
jobs:
  up:
    if: github.event.action != 'closed'
    uses: ./.github/workflows/codespace.yml
    with:
      action: create
      branch: ${{ github.head_ref }}
    secrets:
      PROTON_PASS_PERSONAL_ACCESS_TOKEN: ${{ secrets.PROTON_PASS_PERSONAL_ACCESS_TOKEN }}
  down:
    if: github.event.action == 'closed'
    uses: ./.github/workflows/codespace.yml
    with:
      action: destroy
      branch: ${{ github.head_ref }}
      force: true
    secrets:
      PROTON_PASS_PERSONAL_ACCESS_TOKEN: ${{ secrets.PROTON_PASS_PERSONAL_ACCESS_TOKEN }}
```
