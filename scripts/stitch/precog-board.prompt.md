# Pre-cog Board — Sealed Capability Predictions

Developer tool interface for a Pre-cog board within an IDE workbench adhering to the Pre-cog Telemetry IDE design token set (DESIGN.md).

## Design System Tokens (Pre-cog Telemetry IDE)

- Surfaces: Obsidian canvas (surface `#0b141c`), container (`#182028`), elevated split (`#222b33`), outline borders (`#30363d`).
- Semantic Telemetry Palette:
  - Verified / Deterministic: `#3fb950`
  - Predictive / Analysis Focus: `#58a6ff`
  - Stale / Warning: `#d29922`
  - Alarm / Counterexample: `#f85149`
- Typography: Geist for UI headers and readouts; JetBrains Mono with tabular numbers (font-variant-numeric: tabular-nums) for editor text, gutters, line numbers, squiggles, CodeLens rows, and telemetry data.

## Workbench Structure

- Top status line:
  - Global counters: `0 sealed · 1 done · 1 stale · 1 alarm` and `-- run ended --`
  - Persistent axiom indicator: `reconcile.checkAccess`
- Left split (Pre-cog Prediction Editor):
  - Monaco editor model with line numbers and a gutter displaying sealed capability predictions:
    - Line 1: `L1 deploy · ci/deploy-key` (verified green text `#3fb950`, predicted and observed, status `DONE`)
    - Line 2: `L2 migrate · prod/db-admin` (status `STALE`, predicted never observed, amber squiggle from setModelMarkers at Warning severity, marker code `CAP_STALE_PREDICTION`)
    - Line 3: `!! rotate · prod/db-admin` (status `NOT PREDICTED` / `_unpredicted`, unpredicted divergence, red squiggle from setModelMarkers at Error severity, marker code `CAP_UNPREDICTED`)
  - Directly above Line 3 sits a CodeLens row titled:
    `✗ CAP_UNPREDICTED · 2 related`
  - Hovering Line 3 displays an inline hover carrying the verdict and its evidence:
    `**CAP_UNPREDICTED** same target as L2, different purpose`
    `_fact_ (precog.pkl:2): L2 migrate · prod/db-admin`
    `_observation_ (proton-observed.jsonl:2): rotate token · prod/db-admin`
  - Clicking that CodeLens row opens an evidence widget (.evidence-widget) directly under Line 3, styled with background `#1e1e1e`, border `#454545`, displaying the conflicting evidence locations and supervisor repair choices:
    `[change world] [change model] [change axiom]`
- Right split (Pass Agent Monitor Log):
  - Monaco model showing timestamped access observations:
    - Line 1: `2026-09-20T10:01:00Z deploy staging · ci/deploy-key (matched L1)`
    - Line 2: `2026-09-20T10:02:00Z rotate token · prod/db-admin (unpredicted divergence)`
- Bottom status line:
  - ACP plan_update broadcast stream displaying plan entries with `_stale` and `_unpredicted` status.

## Six Storyboard Frames

1. Frame 1 (render: empty board): Status line displays `0 sealed · 0 done · 0 stale · 0 alarms`. Monaco editor shows placeholder text `// type a prediction`. Pass agent monitor split shows idle state.
2. Frame 2 (predict: typed Pkl, sealed): Status line displays `2 sealed · 0 done · 0 stale · 0 alarms`. Monaco editor shows two sealed predictions in Pkl format (`L1 deploy · ci/deploy-key` and `L2 migrate · prod/db-admin`), both in pending status. Pass monitor split idle.
3. Frame 3 (log: L1 reason + access match): Status line displays `1 sealed · 1 done · 0 stale · 0 alarms`. Monitor records `deploy staging · ci/deploy-key`. Editor Line 1 transitions to `DONE` with verified highlight `#3fb950`.
4. Frame 4 (unpredicted log: alarm row): Status line displays `1 sealed · 1 done · 0 stale · 1 alarm`. Monitor records unpredicted access `rotate token · prod/db-admin`. Editor Line 3 surfaces `!! rotate · prod/db-admin` with red squiggle from setModelMarkers (marker code `CAP_UNPREDICTED`) and CodeLens row above titled `✗ CAP_UNPREDICTED · 2 related`.
5. Frame 5 (run ends: L2 stale): Status line displays `0 sealed · 1 done · 1 stale · 1 alarm` and `-- run ended --`. Line 2 `L2 migrate · prod/db-admin` turns `STALE` with amber warning squiggle (marker code `CAP_STALE_PREDICTION`). Bottom status line shows ACP plan_update broadcast.
6. Frame 6 (hover alarm: pick a repair): Hover over Line 3 displays verdict `**CAP_UNPREDICTED** same target as L2, different purpose` with evidence. Clicking CodeLens row `✗ CAP_UNPREDICTED · 2 related` opens inline evidence widget (.evidence-widget) beneath Line 3 with repair choices: `[change world] [change model] [change axiom]`.
