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

## Validation and environment limits

- Production build passes on Node 22; Storybook static build passes.
- Axe WCAG A/AA: zero violations at 320, 390, 768 and 1440px; no horizontal overflow.
- Reduced-motion, keyboard skip link and contact-anchor checks pass.
- Portfolio Storybook interaction panel reports Pass, including same-frame anchors.
- Existing pre-registered-question story passes Peek on load and reload.
- Tutorial URL loads locally and on the Netlify draft preview. WebContainer startup
  in the cloud browser remains environment-dependent; a complete live execution
  of the tutorial was not asserted.
- `playwright-cli` was attempted but its daemon uses prohibited Unix sockets here.
  Validation used Playwright with Chrome Headless Shell instead. Local `tsx` was
  invoked through `node --import tsx` to avoid the same IPC limit. Those local
  compatibility settings are not repository changes.
- Storybook dev server/review publishing hits denied network-interface enumeration
  in this sandbox. CLI docs/discovery and the static build were used; the live
  curated-review endpoint was unavailable. No generated review URL is claimed.
