# agent-plugins

Tools for keeping agents honest about what they were told.

## delta-zero

**Compiler warnings for context loss.** delta-zero compares an agent's summary with the full thread and flags every paragraph the summary dropped, quoting the lost text with a link to its source.

A user writes "Do not deploy this to production until I have reviewed the diff myself." The summary drops it. delta-zero quotes that sentence back before the agent acts.

**[Read the docs and try it](https://github.com/null-hype/agent-plugins/tree/delta-zero)**

## What else is here

- **[Jev](src/jev)**: typed questions over a state, typed answers with probabilities.
- **[Dev Container features](docs/devcontainer-features.md)**: the agent toolchain, installable from [`src/`](src).
- **[Interactive lessons](tutorial-app)**: step through recorded agent runs in the browser.

## Archive

Earlier experiments, kept for reference and no longer maintained.

- [Agent capability governance prototype](docs/governance-prototype.md), with [`capability-spike/`](capability-spike) and [`tk-evidence-exporter/`](tk-evidence-exporter)
- BountyBench as Dagger modules: [`bountybench-dagger/`](bountybench-dagger), [`bountybench-dagger-django/`](bountybench-dagger-django), [`bountybench-dagger-fastapi/`](bountybench-dagger-fastapi)
- [`jev-playwright/`](jev-playwright)
- [`duo-ios/`](duo-ios)

## Contact

We support two direct routes depending on your context:

- **Public Collaboration & Reproductions:** [Open an issue with the template](https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml) to discuss open-source agent setups, reproduce checks, or ask technical questions. (Public; do not include secrets or proprietary architecture details).
- **Private Enquiries:** Email [`public.rant@pm.me`](mailto:public.rant@pm.me) to discuss internal agent systems or confidential evaluation. Please describe the workflow context; do not send credentials, API keys, or unredacted secrets in an initial message.
