# Pre-cog Board (CIT-199)

Sealed capability predictions reconciled against Proton Pass agent monitor access logs.

## Outcome

A UI flow in which capability needs are **predicted before** an agent acts and **reconciled after** against what the Pass agent monitor actually logged. Each prediction line is a `PROTON_PASS_AGENT_REASON`, but it only counts if it was sealed before the matching log entry, and it is marked done only when the monitor log confirms both the reason and the access record.

## Line States

| State | Meaning | ACP Plan Entry Status |
| :--- | :--- | :--- |
| **Sealed** | Predicted, not yet observed | `pending` |
| **Done** | Predicted and observed; reason **and** access record match | `completed` |
| **Stale** | Predicted, never observed by end of run | `_stale` (custom) |
| **Alarm** | Observed, never predicted | `_unpredicted` (custom) |

The **alarm** state is the product, not the done state. A near-miss (same target as a sealed line, different purpose) is identified as a divergence, and the supervisor can repair it with *change world / change model / change axiom*.

## Protocol Mapping

- **Pre-cog lines $\to$ ACP `plan_update`**: Item-based plans resend the full entry list on every update (`pending`, `completed`, `_stale`, `_unpredicted`).
- **Pass monitor entries $\to$ ACP `tool_call`**: Linked to the plan entry it matched.
- **Diagnostics on prediction lines $\to$ LSP**: (Pkl language server) provides diagnostics on the prediction lines.
- **Ordering Proof**: The prediction's `sealedAt` timestamp must precede or equal the matching log's observation timestamp.

## Storyboard Play Steps

1. `1 · render: empty board` — `0 sealed · 0 done · 0 stale · 0 alarms`, editor prompt `// type a prediction`, monitor idle.
2. `2 · predict: typed Pkl, sealed` — `2 sealed · 0 done · 0 stale · 0 alarms` (`L1 deploy · ci/deploy-key`, `L2 migrate · prod/db-admin`).
3. `3 · log: L1 reason + access match` — `1 sealed · 1 done · 0 stale · 0 alarms` (`L1` turns `DONE` upon `deploy staging` log).
4. `4 · unpredicted log: alarm row` — `1 sealed · 1 done · 0 stale · 1 alarm` (`!! rotate · prod/db-admin` flagged with near-miss diagnosis).
5. `5 · run ends: L2 stale` — `0 sealed · 1 done · 1 stale · 1 alarm` (`L2` turns `STALE`, `-- run ended --`).
6. `6 · hover alarm: pick a repair` — Diagnostic popover displaying `same target as L2, different purpose` with repair choices: `[change world]`, `[change model]`, `[change axiom]`.

## Google Stitch Integration

Implemented using `@google/stitch-sdk` and executed with `pass-cli run --env-file .env`:

```bash
pass-cli run --env-file .env -- node scripts/precog_stitch.mjs [info|generate|download]
```

- **Project ID**: `6209586202936672661` (`Pre-cog Board — Sealed Predictions`)
- **Active Screen ID**: `5691cfcc53f04726a50fb41c0f11aaa4` (`Pre-cog Board - IDE Workbench`)
- **Assets**:
  - HTML snapshot: `docs/precog/precog-board-screen.html`
  - Screenshot preview: `docs/precog/precog-board-screenshot.png`
  - Metadata: `docs/precog/stitch-metadata.json`

## Testing

```bash
# Run unit tests
npm --prefix tutorial-app test

# Build Storybook with all 6 play() steps
npm --prefix tutorial-app run build-storybook
```
