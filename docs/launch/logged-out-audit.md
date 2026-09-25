# End-to-End Logged-Out Journey Audit (CIT-166)

> **Status: VERIFIED for launch.**

This audit tests the complete funnel from a cold-start, logged-out perspective on desktop and mobile:
**Discovery (LinkedIn / Search / GitHub) → Explanation (Landing / README) → Interactive Demo → Executable Evidence → Contact Action**.

---

## 1. Journey Step-by-Step Test

### Step 1: External Discovery (LinkedIn / GitHub Profile)
- **Starting Point:** Visitor reads LinkedIn post, bio, or browses `github.com/null-hype`.
- **Observation:**
  - One-screen headline and proposition immediately communicates: "Clean merge ≠ correct composition · A log of evidence, not promises."
  - Direct links to `null-hype.tidelands.dev` and `agent-plugins` are prominent above the fold.
  - Zero noisy test repositories cluttering the profile tab (reduced to 13 deliberate repositories).

### Step 2: Site & Top-Level Explanation
- **Destination:** `https://null-hype.tidelands.dev`
- **Observation:**
  - Root path immediately routes to `/part-0/overview/start` ("What does a passing check actually tell you?").
  - Clear narrative opening: "An agent says a trip fits the budget. Its two changes merge cleanly. The total is 1290 against a limit of 1200. Which signal should the person approving the trip trust?"
  - Primary CTA button: `Start the budget walkthrough →`.
  - Responsive layout verified on mobile; fixed footer band provides persistent links to Evidence, Source, and Null Hype.

### Step 3: Interactive Demo Walkthrough
- **Destination:** `/part-3/proposal-p-against-the-budget/1-jev-types-the-answer`
- **Observation:**
  - Step 1 (Jev types answer) → Step 2 (clean git merge: 0 conflicts) → Step 3 (semantic check fails: `FAIL @ v1`, 1290 vs 1200) → Step 4 (supervisor grants exception 1200 → 1300) → Step 5 (`PASS @ v2` recorded beside original `FAIL @ v1`).
  - No credentials, login, or installation required; executes directly in WebContainer/browser Monaco environment.

### Step 4: Inspect the Implementation & Evidence
- **Destination:** [`docs/launch/claims-evidence.md`](claims-evidence.md)
- **Observation:**
  - Skeptical technical visitors can drill into the 8-row claim table.
  - Every row lists the claim, source file link, exact CLI command, expected result, and what it does *not* establish (stating known limitations clearly).

### Step 5: Contact & Conversion Path
- **Logged-Out Public Collaboration:**
  - Target: `https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml`
  - Accessible to anyone with a standard GitHub account without repository write permissions.
  - Form prompts for agent system details and discussion goals, with an explicit reminder that issues are public.
- **Logged-Out Private Route (Confidential Systems, Consulting, Funding):**
  - Target: `mailto:public.rant@pm.me`
  - Displayed prominently in `README.md`, `profile/README.md`, landing page, and website README.
  - Standard instructions: "Please describe workflow context; do not send credentials, API keys, or unredacted secrets in initial outreach."

---

## 2. Verification Checklist

| Criterion | Result | Notes |
|---|---|---|
| Contact identity & address clear | PASS | Null Hype / `public.rant@pm.me` |
| Mobile & logged-out behavior | PASS | Clean responsive view, no authentication barrier |
| Broken links & redirects | PASS | All internal & external URLs return 200 |
| Ease of locating contact info | PASS | Located in page body, footer, and README sections |
| Internal follow-up SLA | PASS | Committed acknowledgment within 48 hours |
| Audience alignment | PASS | Public issue form for open collab; private email for consulting/funding/advisory |

---

## Conclusion
A stranger starting from cold search or social media can progress smoothly through problem, proof, evidence, and reach out via either a public or private channel with zero guesswork.
