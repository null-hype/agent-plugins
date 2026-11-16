# delta-zero (Δ0): brief for every worker

Read this first. It is the single source of truth; don't re-derive it.

**Motto:** More difference, less inference.

**One sentence:** delta-zero turns what an agent's summary lost into editor diagnostics,
each quoting the lost text and linking to its source, so the losses that change the next
action are caught before the agent acts. Repair is manual.

## The idea
- A summary is always lossy. In agent workflows, compaction throws context away right
  before the next action, and by default nothing shows what went.
- The loss should be named, visible, traceable to its source and repairable, like a compiler
  warning. The dangerous losses are small distinctions: "implement" survived, "but don't
  deploy until I review" did not.
- Origin: the Fingerspitzengefühl lesson in null-hype/agent-plugins `tutorial-app/`. A gloss
  like "tact" drops four named axes (lexicalization, Gefühl register, Spitzen valence,
  lineage). Naming the axes makes the loss inspectable; compaction is the same problem with
  higher stakes. Say "drops named axes", never "untranslatable".
- Name: delta = difference; zero = no loss left unaccounted for.

## Boundary
Delta (the thread tool) and Zed present threads; delta-zero accounts for loss. Depend on
Delta's thread format; don't build a thread viewer. Every screen shows a loss and its
evidence.

## What exists (this repo, local only, not pushed)
- `pkl_thread.py`: Delta thread (or `--summarize`/`--full` JSON files) → `thread.pkl`, plus
  Witness findings in `.witness/run/`. A loss is flagged when a paragraph is missing from
  the summary, quoting the lost text and labelling it prose or log/tool output.
- `examples/deploy-approval/`: a synthetic 8-message thread, with before/after outputs and
  screenshots from real Neovim, and DEMO.md.
- `editor/init.lua`: a Neovim config that attaches the Witness LSP to `.pkl` files.
- `public/`: profile README, explainer.html, demo GIF. `notes/`: internal notes (AUDIT, AGENT-PLUGINS-ORG, tidelands-section).
  They say "Xanadu" or "delta-pkl"; both names are superseded by delta-zero.
- `thread6/`: private and gitignored. Never publish or quote it.

## What does not exist yet (say so plainly)
- No semantic judgment of which losses matter (Jev, the judgment API, is planned).
- No automated repair.
- No measured results. The planned experiment: targeted repair vs plain re-summarising at
  the same token budget, scored by whether a fresh agent picks the correct next action.

## Assets elsewhere
- `null-hype/agent-plugins` `tutorial-app/` (TutorialKit; serves tidelands.dev).
  Components: GrammarLsp.tsx, LoanwordArcBridge.tsx and EvidenceInspector.tsx (a CodeMirror
  diagnostics setup).
  - Use a git worktree; never touch the main checkout, which is on branch cit-580-backup-hook.
- Witness LSP: github.com/null-hype/witness. Pkl 0.28.2. Neovim and witness are in
  ~/.local/bin.
- Target listing: agent-plugins.org.

## Rules
- Nothing goes public (push, repo creation, profile, site deploy) without Richard's OK.
- Never invent numbers, users or results.
- Install what you need into ~/.local.
- Commit locally as `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`,
  ending the message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PN6eWFGL7kNHKANy7ffbQh
  ```
- Report in under 300 words, with paths to anything visual, checked with Read.
