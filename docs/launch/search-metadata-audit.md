# Search Results, Metadata, and Stale Surfaces Audit (CIT-168)

> **Status: VERIFIED for launch.**

This audit verifies that a visitor searching for the brand, project, or author from a cold start finds coherent, deliberate launch surfaces rather than abandoned scaffolding or contradictory positioning.

---

## 1. Search Query Surface Analysis

| Query / Term | Primary Target | Expected Result | Status |
|---|---|---|---|
| `null-hype` (GitHub) | `https://github.com/null-hype` | Profile README displaying frozen proposition, quick access links, and 13 intentional repositories. Zero test residue. | PASS (live) |
| `null-hype/agent-plugins` | `https://github.com/null-hype/agent-plugins` | Main project repository with frozen description, Budget Authority guide, evidence table, and dual contact routes. | PASS |
| `null-hype.github.io` | `https://github.com/null-hype/null-hype.github.io` | Technical landing page with architecture diagram, local quick start, and direct links to tidelands walkthrough. | PASS (live) |
| `null-hype.tidelands.dev` | `https://null-hype.tidelands.dev` | Interactive TutorialKit walkthrough; root redirects to `/part-0/overview/start`. | PASS (live Netlify target) |

---

## 2. Elimination of Stale Public Residue

- **Automated Test Repositories Retired (CIT-257):**
  - Audited 64 public repositories on the `null-hype` account.
  - Converted 50 disposable test fixtures and automated scratch repos to `private` (including `Real-E2E-Test-*`, `project-*`, `playwright-cli-demo-*`, `e2e-project-*`, `Hence-Phrasing`, `sprite`, `uplifted-evil`, `molecule-oozy`, etc.).
  - Preserved only 13 deliberate, maintained repositories: `agent-plugins`, `null-hype.github.io`, `null-hype`, `playwright-cli`, `goose`, `bountytasks`, `tree-sitter-just`, `zed-just`, `vertex-ai-creative-studio`, `scaling-guide`, `veo-3-nano-banana-gemini-api-quickstart`, `codesandbox-sdk-example-1`, `codespaces-blank`.

- **Retirement of Outdated Framing (CIT-154):**
  - Prior copy focused heavily on "The Cyber Farm", "auditing the void", and "high-frequency automated network scanning", which misdirected due diligence toward offensive bot operations rather than agent governance.
  - Replaced across all profiles with the frozen capability governance proposition: *"a log of evidence, not promises."*

- **Website Repository Placeholder Removal (CIT-155):**
  - Replaced the 2-line placeholder README with a complete technical overview, architecture diagram, local execution guide, and evidence links.

---

## 3. Metadata, OpenGraph & Social Preview Audit

- **Site Title:** `Agent decisions, checked against evidence`
- **Site Description:** `Follow an agent proposal from confident answer to failed check and scoped approval. Inspect the rules, recorded decisions, and evidence behind each verdict.`
- **OpenGraph Tags:**
  - `og:site_name`: `Null Hype`
  - `og:type`: `website`
  - `og:title`: `Agent decisions, checked against evidence`
  - `og:description`: `Follow an agent proposal from confident answer to failed check and scoped approval. Inspect the evidence behind each verdict.`
- **Twitter Card:**
  - `twitter:card`: `summary`
  - `twitter:title`: `Agent decisions, checked against evidence`
  - `twitter:description`: `Follow an agent proposal from confident answer to failed check and scoped approval. Inspect the rules, recorded decisions, and evidence behind each verdict.`
- **Favicon & Web App:**
  - `favicon.svg` present in `tutorial-app/public/`.
- **Canonical Routing:**
  - Root `/` emits immediate `<meta http-equiv="refresh" content="0;url=/part-0/overview/start">` to land visitors directly on the contextual introduction before interactive lessons.

---

## 4. Link Integrity Audit

All inter-document links and CTAs verified:
- `docs/launch/claims-evidence.md` links to exact paths in `capability-spike/`, `tutorial-app/`, and `tk-evidence-exporter/`.
- `docs/launch/demo.md` commands tested and verified locally.
- Contact links resolve to `https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml` and `mailto:public.rant@pm.me`.
- Zero broken relative markdown links in launch docs.
