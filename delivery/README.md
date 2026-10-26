# delivery

The plan, as Playwright projects:

- `plan`: the planner has Jules plan the goal in `goal.md`, repoless and
  stopping at its plan, so it writes nothing.
- `judge`: the judge, under its own key, has Jev judge Jules's plan against the
  goal and against ours.
- `audit`: afterwards, in the owner's own Pass session (the only one that sees
  every agent's accesses), each agent's reasons, and whether each is still
  urgent given what the run produced. A finished run should score low.

```sh
npx playwright test -c delivery --project plan --project judge     # from jev-playwright
DELIVERY_RUN=<a run's test-results> npx playwright test -c delivery --project audit
```

A plan that is not ready yet fails as not yet: run it again later. In CI, `plan`
and `judge` run on a pull request labelled `dispatch`, and the run's
`test-results` are kept as an artifact for the audit.

## Agents

Each agent has its own Proton Pass vault and token, and can read only what it is
meant to call, so the chain of who can start whom is the vault access itself:

| Agent | Vault | Starts with | Calls |
| --- | --- | --- | --- |
| root | `jev-root` | `claude-code`, `planner-token` | starts the planner |
| planner | `jev-planner` | `jules` (and its `journal`) | Jules |
| worker | `jev-worker` | `typesafe` | Jev, from inside Jules |
| judge | `jev-judge` | `typesafe` (and its `journal`) | Jev, for the verdict |

The plan project runs as the planner and only plans; the judge project runs as
the judge and does all the judging. The judge can read the planner's journal and nothing else
of anyone's.

Set it up once, logged in as yourself:

```sh
pass-cli login
bash delivery/bootstrap.sh
```

It asks for each starting credential (never echoed), creates the vaults,
journals and tokens, grants each token editor on its own vault, and sets the
`JEV_ROOT_PASS_TOKEN` and `JEV_JUDGE_PASS_TOKEN` CI secrets with `gh`. A secret
`gh` cannot set is kept in `jev-owner`, which no agent can read, for you to set.
The planner's token goes into `jev-root/planner-token`. Re-running reuses what
exists.

One step is yours: copy `jev-worker/typesafe/TYPESAFE_API_KEY` into Jules's
settings. Jules cannot use `pass-cli`, so that hop is outside Pass.

Locally, without CI's sessions, every agent is you.
