# Portfolio: cut-paper direction

Draft exploration for Richard Anthony / null-hype. Base: `8dd8a333` on main.

## References and interpretation

- PR #384's landing page supplied positioning, evidence links, experience and availability.
- `tutorial-app/public/logo.svg` remains the circled Ionic T introduced in #158.
- The current `null-hype/null-hype` README supplied “A log of evidence”.
- Existing social artwork and `docs/storyboards/follower-maze/` were inspected.
  They establish evidence labels and annotations, not a cut-paper brand system.
- No checked-in ransom-note/collage reference was found. Warm paper, charcoal,
  rust, a tilted headline fragment and a serif counterpoint are this pass's
  interpretation. Body text stays conventional. No external font requests.

## Implementation boundary

`PortfolioLanding.tsx` renders static HTML in Astro and the same markup in
Storybook. There is no `client:*` directive, hydration, new dependency or route
configuration change. CSS is scoped beneath `.portfolio` so tutorial styles are
unaffected. Storybook serves existing public assets to show the real logo.

The primary CTA retains the exact Worlds proof anchor. The private-file tutorial
route, source links, contact email, experience and availability are preserved.
Technical explanations stay short and send the reader to the repositories.

## Review assets

- `before-desktop.png`, `after-desktop.png`: 1440px viewport.
- `before-mobile.png`, `after-mobile.png`: 390px viewport.
- `tutorial-route.png`: preserved tutorial entry.
- `validation.json`: landing accessibility/reflow and navigation checks.
- `tutorial-app/public/portfolio-social.svg`: editable 1200 × 630 profile/social draft.
- `tutorial-app/public/portfolio-social.png`: browser-rendered raster for social metadata.

The before screenshots render the exact baseline Astro source at a temporary
local route; that route was removed and is not part of this change. The after
screenshots use the built site, without the Astro development toolbar.

For a GitHub README, use an ordinary linked image with meaningful alt text:

```md
[![Richard Anthony — verification infrastructure for agent-produced software](https://www.tidelands.dev/portfolio-social.png)](https://www.tidelands.dev/)
```

That production URL becomes valid only if this draft is approved and published.
Until then, review the file in this PR. The profile repository was not edited.
SVG works as an image in GitHub Markdown; PNG is supplied for social crawlers.

## Stitch

Stitch was **not run**. `STITCH_API_KEY` was absent in this cloud environment.
No Pass session, vault export or unrelated service token was used. The existing
script was read; it defaults to an unrelated project. A future Stitch comparison
needs securely injected `STITCH_API_KEY` and an explicit new portfolio project
ID. `scripts/stitch/portfolio-cut-paper.prompt.md` captures the proposed brief.
No existing Stitch metadata or project was changed.
