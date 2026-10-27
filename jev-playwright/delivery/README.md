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

What the work should do to each step of Jules's plan is the prediction. The
planner registers it in Pass in its journal (`jev-planner/journal`, field
`plan`) at the turn from planning to execution: once Jules has presented its
plan, and before the plan is approved. The judge can view that journal and not
change it, so the prediction is fixed by who can write it, not by what is in
the repo.

So the experiment does not ask whether the planner can foresee how Jules will
word a plan it has not made: a fresh Jules words its steps differently each
time, and predictions written against an earlier plan's titles can match
nothing. It asks: given the plan Jules presented, can the planner commit, before
any work, to what carrying out each step should do, and does the work bear that
out? The plan is the program under test; the predictions are the expectations
committed before it runs. Whether separate Jules runs plan alike is another
question, not tested here.

The check stops at the plan until the planner has registered for exactly its
steps, after Jules was asked for it, and prints them (`ready.mjs`).
`register.mjs` checks the shape with `Predicted.pkl` before writing:

```sh
pass-cli run --env-file .env -- dagger check registered-delivery   # stops at the plan, printing its steps
node delivery/register.mjs predictions.json   # [{ "title": ..., "after": "cools" | "steady" }, ...]
pass-cli run --env-file .env -- dagger check registered-delivery   # the same plan, approved and worked
```

Two checks, the second composing the first:

- `dagger check people-can-install-witness`: the world. It installs the feature
  Jules wrote in a clean dev container, handing failures back for repair, each
  repair into a fresh one (the feature alone: unlike the dev container CLI, the
  check installs nothing it `dependsOn`, and the evidence tells Jules so); reads both runs through the witness it installed;
  and `Reconcile.pkl`'s `installed` judges that every answer is fresh and on
  its test's line.
- `dagger check registered-delivery`: the experiment. Jules's sessions are keyed
  by its `run` (default `registered`; `REGISTEREDDELIVERY_RUN` in `.env`
  changes it): the same key resumes the same plan, so the planner registers
  for it between two checks; another asks Jules anew. After the run the judge
  reads the predictions again, and `Reconcile.pkl`'s `facts` add: they were
  last changed after Jules was asked for the plan and before Jules recorded
  the plan approved, both runs show exactly the predicted steps, Jev answered
  on the registered model, and each step moved as predicted. The verdict
  names the Pass item and when it was last changed (`pkl test
  Reconcile.test.pkl`).

A snapshot is a complete experimental world. Labels describe its provenance.
`registered-delivery` evaluates the same registered claim against whichever
world is selected. The world is a restic snapshot (`world.sh`) of what the
check judges: witness's answers on both runs, the spec they are on the lines
of, the predictions as read, and the feature. After a run the check captures it
as `label=observed` (tags `check=registered-delivery`, `label=`, `run=`), then
restores the newest snapshot with the label into a fresh directory and judges
that; the output and verdict name the snapshot id. `REGISTEREDDELIVERY_LABEL=synthetic`
in `.env` (`dagger check` takes no flags) judges a world made by data instead,
without running Jules: `dagger call capture-world --world delivery/worlds/run7
--label synthetic`, then `dagger check registered-delivery`. Run 7 is kept in
`worlds/run7` (rebuilt from the printed scores in `worlds/Scenarios.pkl`, so synthetic) and gives the same
verdict through its snapshot. `bash delivery/world.test.sh` tests capture,
selection by label, restore and judgement against a disposable repository.
`observed` runs the delivery and snapshots it; it does not select an earlier
observed world, so an old one cannot yet be judged again without asking Jules
anew. The repository is a cache volume, local to the engine, which can prune it:
a snapshot id is reproducible only while it lasts, and `worlds/` (rebuilt by
`worlds/mk.mjs` from `worlds/Scenarios.pkl`, which `Reconcile.test.pkl` imports) is the durable copy of
the fixtures. The repo's own convention is the shared repository behind
`pass://infra/restic`, passed in as a secret, which is the next step.

The verdict keeps three layers apart: the world (does the feature install,
and is every answer fresh and on its line), the protocol (were the
predictions fixed for this plan before its work, on the registered model),
and Jev (did each step move as registered). A run whose world or protocol did
not hold is not valid and says nothing of Jev; the verdict names which. A run
where both held is valid, and what Jev did is a finding either way: agreement
turns the experiment green, and disagreement, "valid finding: Jev
disagreement", turns it red without making the run a failed one. The check
exits non-zero for both a run that is not valid and a red experiment, and its
last line says which. The threshold (`moved` in `Delivery.pkl`) is not tuned
to a red result.

Run 7 is such a finding, kept as a frozen falsification case: the repaired feature installed
witness, the protocol held, and the two file steps did not cool (+0.02 and
−0.09, against −0.14), while the first, broken feature had cooled them. So
what a Jev step score measures, and when successful work should cool it, is
the open question, not how to make the next run pass. That the world does not
resolve `dependsOn` is a fidelity gap, not its explanation: the run that
disagreed is the one where witness installed. A change that turns run 7 green
changes what the score means, and has to say how; it is not a fix. Its
approval and repair times stand in, after the registration: the case tests the
order the protocol needs, not the run's whole record.

After a deliberate change (another model or question): produce a plan and a
work run, measure the noise on them, and set it in `Delivery.pkl`.

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
