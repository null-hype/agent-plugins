# Audit of what is public (checked 2026-11-16, read-only)

## What is live
- **GitHub profile** (`null-hype`, display name "Null Hype", 17 public repos). Bio: "Verification infrastructure for agent-produced software. Capture the world, run the check, preserve the evidence. Sydney." The `blog` field is empty.
- **Profile README** (`null-hype/null-hype`): leads with "I build verification infrastructure for agent-produced software", a pipeline diagram `agent / CI -> worlds -> checks -> findings -> witness -> editor`, and a table of worlds, witness, features. "Research / origin" links to agent-plugins, a two-minute demo, a claims doc and the governance walkthrough. Ends with the availability line and `public.rant@pm.me`. The repo itself has no description.
- **Pinned** (5): worlds ("Agentic delivery harness: capture reproducible worlds and evaluate registered claims against frozen evidence."), witness (no description), agent-plugins ("agent-plugins.org"), features (no description), null-hype.github.io (no description).
- **tidelands.dev** (301 to www.tidelands.dev, 200). Title "Richard Anthony - verification infrastructure for agent-produced software". Live HTML matches `TidelandsHome.tsx` (blob `40db244` on `main` equals the checked-out copy). Hero: "A green check should lead to evidence you can inspect." Primary button: "Inspect the Worlds proof". Then an interactive Worlds-style integration check, three project cards (Worlds, Witness, a tutorial challenge), and the work-together section.
- **witness** README (public): a small LSP for source-addressed findings. It already says Jev and Dagger are not part of the contract.
- **Fingerspitzengefuhl lesson**: `tutorial-app/src/content/tutorial/part-1/chapter-1/lesson-2/` in `null-hype/agent-plugins` on `main` (chapter "Lexical Irreducibles"). The lesson's `LoanwordRules.pkl` names four loss axes: lexicalization, Gefuhl register, Spitzen valence, lineage.
- **delta-pkl**: does not exist on GitHub (`gh repo view null-hype/delta-pkl` fails). It is local only.

## What supports the idea
- Witness is already public and is the editor half of the demo. Its contract (source-addressed finding, severity, evidence, `sourceHash` for staleness) is exactly what the demo emits.
- The tutorial lesson is a real, public artifact of the origin story: a typed Pkl rule that lists, by name, what a gloss loses.
- The tone of the existing pages (evidence, limits stated, "synthetic fixtures") fits the new framing.

## What distracts
- Everything above Witness leads with Worlds: the profile README diagram and first CTA, the tidelands hero button, the first project card, the pinned order. Worlds is the supervisor-loop work the idea moves away from.
- "Verification infrastructure" is the headline everywhere. A visitor learns the category, not the claim that lossy compaction should be visible.
- Three of five pinned repos have no description, so the pinned grid shows blanks.
- agent-plugins is pinned with only the description "agent-plugins.org".
- The profile README is long (diagram, table, three link groups) before any picture or demo.
- The contact surfaces differ: the README uses `public.rant@pm.me`; the GitHub API's public email field is a different address. Tidelands uses `public.rant@pm.me`. Name differs too (Null Hype / Richard Anthony), which is fine but unexplained.

## What is missing
- Any mention of compaction, summaries, Delta or Pkl-as-shape-of-knowledge on the profile or tidelands.
- A public repo for the demo, so nothing can link to it yet.
- A picture on the profile. The only visual is a text diagram.
- A path from the Fingerspitzengefuhl lesson to the compaction idea. The lesson text itself says its vocabulary rule is "a chosen vocabulary policy, not a claim that English cannot express the idea", so the story must be told as "a gloss drops named axes", not "English cannot say it".
- Descriptions for witness, features, null-hype.github.io and the profile repo.
- Verified lesson URL on tidelands.dev: the guessed paths under `/part-1/` return 404, so the draft links to the source on GitHub instead.
