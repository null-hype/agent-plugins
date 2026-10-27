# delivery

The plan, as Playwright projects:

- `plan`: the planner has Jules plan the goal in `goal.md`. The session is
  repoless, so the prompt carries the code; Jules waits with its plan.
- `judge`: the judge, under its own key, has Jev judge Jules's plan against the
  goal and against ours.
- `build`: the planner approves the plan and keeps the patch Jules makes
  (`jules.patch`, to apply at `jev-playwright/`).
- `audit`: afterwards, in the owner's own Pass session (the only one that sees
  every agent's accesses), each agent's reasons, and whether each is still
  a priority given what the run produced. A finished run should score low.

```sh
npx playwright test -c delivery --project plan --project judge --project build   # from jev-playwright
DELIVERY_RUN=<a run's test-results> npx playwright test -c delivery --project audit
```

## The registered delivery

`Delivery.pkl` says what the `feature` node runs and how it is measured:
Jules's task, Jev's question and model, and the noise in Jev's answer. The
config evaluates it before any test.

What the work should do to each step of Jules's approved plan is the
prediction, and the planner registers it in Pass before the run, in its
journal (`jev-planner/journal`, field `plan`). The judge can view that journal
and not change it, so the prediction is fixed by who can write it, not by
what is in the repo. `register.mjs` checks the shape with `Predicted.pkl`
before writing:

```sh
node delivery/register.mjs predictions.json   # [{ "title": ..., "after": "cools" | "steady" }, ...]
```

Two checks, the second composing the first:

- `dagger check people-can-install-witness`: the world. It installs the feature
  Jules wrote in a clean dev container, handing failures back for repair, each
  repair into a fresh one; reads both runs through the witness it installed;
  and `Reconcile.pkl`'s `installed` judges that every answer is fresh and on
  its test's line.
- `dagger check registered-delivery`: the experiment. The same world, then the
  judge reads the predictions fresh from Pass (`registered.mjs`) and
  `Reconcile.pkl`'s `facts` add: the predictions were last changed before the
  plan run began, both runs show exactly the predicted steps, Jev answered on
  the registered model, and each step moved as predicted. The verdict names the
  Pass item and when it was last changed (`pkl test Reconcile.test.pkl`).

To re-register after a deliberate change (another model, plan or question):
produce a plan and a work run, measure the noise on them, set it in
`Delivery.pkl`, and register the predictions again.

```sh
node delivery/capture.mjs <plan run>/priorities.json <work run>/priorities.json   # writes noise-observed.json
```

A plan or patch that is not ready yet fails as not yet: run it again later. In CI, `plan`,
`judge` and `build` run on a pull request labelled `dispatch`, and the run's
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

The plan and build projects run as the planner; the judge project runs as
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
