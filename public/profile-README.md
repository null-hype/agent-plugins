# Null Hype

**A summary always loses something. The loss should be named, visible, traceable to its source and repairable, like a compiler warning.**

When an agent compacts its context, whatever the summary drops is gone before the next action, and nothing tells you. The dangerous drops are small: "go ahead and implement it" survives, "do not deploy until I have reviewed the diff" does not.

![A compacted thread opened in Neovim. A diagnostic on the user's approval reads: message 3 (user) dropped prose: "Do not deploy this to production until I have reviewed the d..."](https://raw.githubusercontent.com/null-hype/delta-pkl/main/examples/deploy-approval/screenshot.png)

*Before: the summary reads as permission to ship. The diagnostic quotes the sentence it lost.*

![The same summary after one sentence is restored. The line-27 diagnostic is gone; only the harmless pytest-log omission remains.](https://raw.githubusercontent.com/null-hype/delta-pkl/main/examples/deploy-approval/screenshot-repaired.png)

*After: one sentence restored, one finding gone. The other finding, a pytest log, is a loss worth keeping.*

Both screenshots are a real Neovim session on a synthetic 8-message thread. **[Run it yourself: delta-pkl](https://github.com/null-hype/delta-pkl)** (no Delta needed, about two minutes).

## Where it comes from

In my tutorial app there is a lesson on *Fingerspitzengefühl*. A gloss like "tact" keeps one piece of the word and drops the rest, and the lesson's rule file names what goes: lexicalization, Gefühl register, Spitzen valence, lineage ([the lesson](https://github.com/null-hype/agent-plugins/tree/main/tutorial-app/src/content/tutorial/part-1/chapter-1/lesson-2)). Naming the axes is what makes the loss something you can look at. A compacted agent context is the same problem, with higher stakes, because the next action depends on what was dropped.

## The pieces

- **Delta**: threads and their summaries.
- **Pkl**: a typed shape for the compressed knowledge, so a summary can be checked rather than just read.
- **[Witness](https://github.com/null-hype/witness)**: a language server that shows source-addressed findings in the editor, with evidence navigation and stale-source detection. It is what puts the loss on the line where it happened.
- **Jev**: a judgment API, planned as the judge of whether a loss matters. Not wired in yet. Today a person decides, in seconds, because the lost text is quoted.

## What is not built

The detector is a paragraph-presence check, not a semantic one. Judging which losses matter, and repairing the summary automatically, are the next experiment: semantic coverage plus targeted repair against plain re-summarising at the same token budget, scored by whether a fresh agent picks the correct next action. No results yet.

## Earlier work

[Worlds](https://github.com/null-hype/worlds) is an agentic delivery harness: it captures reproducible worlds and evaluates registered claims against frozen evidence. It is a case study in how much machinery a supervisor loop takes, and part of why the work above is deliberately smaller.

---

Available for senior software, security and AI infrastructure roles, and selected consulting work: [public.rant@pm.me](mailto:public.rant@pm.me). More at [tidelands.dev](https://www.tidelands.dev/).
