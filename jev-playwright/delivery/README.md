# delivery

The plan, as Playwright tests. `plan.spec.ts` asks Jules to plan the goal in
`goal.md`, repoless and stopping at its plan, and Jev judges that plan against
the goal and against ours. `retro.spec.ts` checks that every reason the run gave
Proton Pass is in the Pass monitor log, and asks Jev whether each serves the
goal.

```sh
npx playwright test -c delivery     # from jev-playwright
```

A plan that is not ready yet fails as not yet: run it again later. In CI it
runs on a pull request labelled `dispatch`.

## Access

The run reads two keys from Pass, each fetch under its own reason:

- `pass://infra/jules.google.com/JULES_API_KEY` (override with `JULES_KEY_REF`)
- `pass://infra/typesafe.ai/TYPESAFE_API_KEY` (override with `TYPESAFE_KEY_REF`)

Run as yourself (`pass-cli login`), or as an agent token that can read only
those two items. To set up the token, logged in as yourself:

```sh
pass-cli login

# 1. The Jules key (from Jules's settings) must be in Pass first: in the Pass
#    app, vault `infra`, an item titled `jules.google.com` with a hidden field
#    `JULES_API_KEY`. Then check both keys resolve:
pass-cli item view pass://infra/jules.google.com/JULES_API_KEY >/dev/null && echo jules ok
pass-cli item view pass://infra/typesafe.ai/TYPESAFE_API_KEY >/dev/null && echo typesafe ok

# 2. The agent's token. pass-cli prints it once: keep it for step 4.
pass-cli personal-access-token create --name jev-delivery --expiration 3m

# 3. Read access to those two items only.
for item in jules.google.com typesafe.ai; do
  pass-cli personal-access-token access grant \
    --personal-access-token-name jev-delivery \
    --vault-name infra --item-title "$item" --role viewer
done

# 4. Give CI the token (paste it when asked).
gh secret set JEV_DELIVERY_PASS_TOKEN --repo null-hype/agent-plugins
```

To check the token before CI does, in a fresh shell:

```sh
export PROTON_PASS_PERSONAL_ACCESS_TOKEN=<the token>
export PROTON_PASS_KEY_PROVIDER=fs PROTON_PASS_SESSION_DIR="$(mktemp -d)"
pass-cli login
pass-cli item view pass://infra/jules.google.com/JULES_API_KEY >/dev/null && echo jules ok
pass-cli item view pass://infra/typesafe.ai/TYPESAFE_API_KEY >/dev/null && echo typesafe ok
pass-cli agent monitor --output json | head -c 400; echo
pass-cli logout
```

The last check matters for retro, which reads the monitor log as this token. If
`agent monitor` refuses a token session, retro needs your own session instead.
