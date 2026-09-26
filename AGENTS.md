# Credential access

- Use `pass-cli` for credentials needed for user-requested tools and websites. Check installation with `pass-cli --version`; if absent, follow https://protonpass.github.io/pass-cli/get-started/installation/.
- Before authentication or credential operations, export a unique `PROTON_PASS_SESSION_DIR=/tmp/pass-agent-<unique-name>` to isolate this agent's session.
- Check `pass-cli info` before each subsequent pass-cli command (the health check itself is exempt). Recheck during long tasks.
- Read the entire output of failed commands. For expired or invalid authentication, clear the isolated stale session with `pass-cli logout` (or `logout --force` if necessary), log in using `PROTON_PASS_PERSONAL_ACCESS_TOKEN`, verify with `pass-cli info`, then retry. Do not treat unrelated failures as authentication failures.
- The supplied PAT is stored in macOS Keychain under service `codex-pass-cli-pat`, account `retro.tidelands.dev`. Retrieve directly into the login process environment; never print it or copy it into source, logs, or memory documents.
- After login, verify access using `pass-cli vault list` and `pass-cli share list`, checking session health before each. Report results when requested; report errors if vaults cannot be listed.
- Set a specific `PROTON_PASS_AGENT_REASON` for every item view/create/update/trash/untrash and vault update, and when using `pass-cli run` to inject credentials.
- Prefer `pass-cli run --env-file` for credential injection, `pass://` references for stored secrets, and `--output json` for programmatic discovery. Request only the field needed when reading an item.
- Full CLI documentation: https://protonpass.github.io/pass-cli/.

# Tropfest context

- Focus on narrative development and using this repository's ACP debugger as a method for producing generative media. Ignore retired goose grant threads.
- The Linear MCP is connected to the user's currently active workspace. Do not assume it contains Tropfest; use `scripts/search_linear.sh` with the credentials referenced in `scripts/linear.env` for that search. Export the authenticated isolated session directory before invoking the wrapper.
