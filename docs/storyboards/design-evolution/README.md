# Design evolution (Stitch)

Variations on the Tidelands theme, bred in Stitch project `12198575817421645956`
("Tidelands — design variations"). Every screen is the same landing lesson
(`structure.md`); only the design system changes.

## Gen 1: four systems from text (`gen.mjs`)

| Screen | Prompt | Verdict |
| --- | --- | --- |
| `gen1/ransom` | `ransom.prompt.md` | Liked; enhance it. Becomes the parent. |
| `gen1/blueprint` | `blueprint.prompt.md` | Good: NOTE callout, evaluation-dump code block, title block |
| `gen1/telemetry` | `telemetry.prompt.md` | OK: callout, code block, data-grid table |
| `gen1/tidepool` | `tidepool.prompt.md` | Bad; dropped |

## Gen 2: variants of Ransom with the picks grafted in (`evolve.mjs`)

`gen2/graft.prompt.md` against the gen-1 ransom screen, three at
`creativeRange: EXPLORE` (`xa`–`xc`) and two at `REIMAGINE` (`ra`, `rb`).
Not yet reviewed.

The grafted blocks are implemented in `tutorial-app/src/styles/ransom-plus.css`
and shown in the Storybook story `Brand/Variations/Ransom+ (gen 2)`.

## Running

```bash
echo 'STITCH_API_KEY=pass://infra/stitch.withgoogle.com/STITCH_API_KEY' > /tmp/stitch.env
PROTON_PASS_AGENT_REASON="…" pass-cli run --env-file /tmp/stitch.env -- \
  node evolve.mjs <out-dir> g3 <parent> gen3/graft.prompt.md EXPLORE 3 x
```

`evolve.mjs` calls `generate_variants` directly: the SDK's `getScreen`
lookup is rejected by Stitch ("Request contains an invalid argument").
