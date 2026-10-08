## Screen structure (identical across every variation; only the design system changes)

Desktop, 1440 wide. A research tutorial site called "Tidelands" about making AI-agent decisions reviewable.

- Top bar, 56px: at left the logo mark (a circle containing an Ionic-capital "T": a horizontal bar ending in two small scroll volutes, a stem that splays into a whale-tail fluke at the base), then the wordmark "Tidelands". Centre: breadcrumb "Start here / What does a passing check actually tell you?". Right: a small "Solve" button and a "→" next-lesson arrow, then a GitHub icon.
- Left rail, 280px: lesson outline with six parts: "Start here", "Labs: rules, access, and reconciliation", "Evidence: a recorded diagnostic", "Walkthrough: budget and authority", "Research: what a green check misses", "Jev: questions become diagnostics". The first is selected.
- Main column, prose at a 68ch measure:
  - H1: "What does a passing check actually tell you?"
  - Lead paragraph (larger): "An agent says a trip fits the budget. Its two changes merge cleanly. The total is **1290 against a limit of 1200**."
  - Paragraph: "Which signal should the person approving the trip trust?"
  - Primary call-to-action button: "Start the budget walkthrough".
  - Paragraph: "In five turns, follow one proposal through a confident answer, a clean merge, a failed check, a supervisor's exception, and a new evaluation. The original failure stays visible. Every verdict names the rule it used."
  - An info callout titled "How to follow the replay": "Choose Solve to reveal the next reply, then the → arrow to continue. Each part is a thread; each lesson is a turn."
  - A two-column table, header "Your question | Where to look", rows: "Where did the diagnostic come from? | A recorded exchange and its evidence"; "What can a green security check miss? | The merge experiment"; "How do claims, grants, and observations disagree? | Hands-on reconciliation lab".
  - H2 "Next steps" with three bullet links: "Run the demo", "Inspect the evidence", "Discuss applying this to an agent system".
  - A small inline code sample block, 4 lines of Pkl: `budget { limit = 1200; total = 1290 }` and a diagnostic line `✗ BUDGET_EXCEEDED  total 1290 > limit 1200`.
- Real text only; no lorem ipsum, no stock photos, no avatars.
