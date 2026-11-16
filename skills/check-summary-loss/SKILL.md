---
name: check-summary-loss
description: Checks what an agent's summary (compaction) dropped from the full conversation, and reports each lost paragraph quoted. Use when the user asks whether a summary lost anything, before acting on a summarized or compacted Delta thread, or when given a summarize/full JSON pair to compare.
compatibility: Requires Python 3 and Pkl on PATH; a Delta thread also needs the delta CLI. Run from the plugin root.
---

# Check a summary for loss

The detector is `pkl_thread.py` at the plugin root (two directories above this file). Run commands from the plugin root.

## 1. Run the detector

On a Delta thread:

    python3 -I pkl_thread.py <thread> <out>

On two JSON files in the shape `delta thread show` prints (summarize format and full format), without Delta:

    python3 -I pkl_thread.py --summarize <summarize.json> --full <full.json> <out>

`<out>` is a new or scratch directory. The run writes `<out>/thread.pkl`, `<out>/.witness/run/findings.json` and one evidence file per finding in `<out>/.witness/run/evidence/`. A worked input is `examples/deploy-approval/` (`summarize.json`, `full.json`).

## 2. Read the findings

Read `<out>/.witness/run/findings.json`. If it has no findings, say that no paragraph was found missing, and give the limit in step 5. For each finding report:

- the message number and role, and the severity;
- whether the loss is labelled `prose` or `log/tool output`;
- the lost text, quoted. The diagnostic message shows only the first ~60 characters; open the evidence file the finding points to and quote the full lost paragraph.

## 3. Weigh the losses

- Treat `prose` losses as possibly consequential. A user instruction, constraint, approval condition or decision may be among them. List these first.
- Treat `log/tool output` losses as usually safe to drop (test logs, command output). Mention them briefly, still quoted, and say they are usually safe.
- The label is a line-shape heuristic. If a "log" paragraph contains an instruction, treat it as prose.

## 4. Ask before acting

If a dropped paragraph might forbid, gate or condition the next action (for example "do not deploy until I review"), stop and ask the user before doing that action. Show the quoted text and ask whether it still holds. Do not infer permission from the summary alone.

## 5. Be honest about the limit

Detection is structural, not semantic. A loss means a paragraph of the full message was not found in the summary text, after whitespace is collapsed. So:

- a constraint the summary paraphrased is still reported as lost (false alarm);
- a constraint lost inside a paragraph that otherwise survives can be missed;
- the tool does not judge which losses matter. You and the user do.

Say this in your report. Do not claim the summary is safe because nothing was flagged.
