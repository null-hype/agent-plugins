# yoars-handoff: delta-zero on a real, public multi-agent run

Source: Zenodo record 23755352 (v1.0.1), "yoars" corpus, licensed CC BY 4.0. Run `deepseek-flash-225035`: four agents (planner, auth, backend, ui) build a three-file data pipeline through a shared room ledger (`messages.json`) and a git remote. Each agent holds rules the others do not, and keeps its own session (`session-<role>.jsonl`). The files here are excerpts of that run, re-shaped; nothing in them is generated.

## How a handoff pair is defined

- **summary** = one ledger message an agent posted to another agent (the sender's own condensed account).
- **full** = that sender's own session, from its start up to the moment it posted: prompt (which holds its private rules), assistant text, tool calls and results.

`adapters/yoars.py RUN_DIR SEQ PREFIX` builds the two JSON files. Changes from the corpus: the session is flattened to messages (thinking blocks and bookkeeping records dropped; tool results cut to 1500 characters; the tool call that posted the message left out). Pairs: `pairs/msg5482` (ui to backend), `msg5484` (backend to ui), `msg5486` (planner to ui), `msg5492` (planner status to the channel). Findings are committed for 5484 and 5492 in `out-5484/` and `out-5492/`; run the other two the same way.

    python3 -I ../../pkl_thread.py --summarize pairs/msg5484-summarize.json --full pairs/msg5484-full.json out-5484

delta-zero flags nearly everything here (39 findings for 5484, 126 for 5492): a one-paragraph message cannot carry a whole session, and most of the session is file reads and retries. The two losses below were found by reading those findings against what the receiver needed; each sits inside a flagged message (`m35-dropped` in `out-5484`, `m115-dropped` in `out-5492`). The run passes its acceptance check 6/6, so neither loss changed the outcome: both are latent.

## Findings

**1. A decision the sender made did not reach the receiver (backend to ui, ledger message 5484).**
In `pairs/msg5484-full.json` message 35 the backend reasons: `gauge "" -> ? (empty line case, will be dropped anyway since epoch/person empty)`. Message 36 then writes `transform.py` with `# "plain" (and "" before a drop) pass through unchanged`. Message 5484 says only `worth scaled by gauge (hundredths/100, thousandth*1000, plain pass)`. An empty unit label is therefore passed through unscaled, and the message never says so. By reading auth's `parse.py` (corpus `clones/auth`), a pair-format line with an unknown or missing `u` gets `gauge = ""`; its person and time are valid, so it is kept and its value is not scaled. Effect on the receiver: none visible. ui's `report.py` sums `worth` per group as given and has no check; no probe line uses an unknown unit. This is a latent loss, found by reading code, not run.

**2. A requirement was unmet and the status did not say so (planner to channel, ledger message 5492).**
The operator's kickoff (message 5490) says "Agree the interfaces BEFORE anyone writes code". In `pairs/msg5492-full.json` message 115 the planner notes `parse.py and transform.py are already landed (contrary to "agree before code")`. Message 5492 reports "Team's done" and that the divergence is "the expected divergence, not a bug" without saying the order was not followed. Effect on the receiver: none; the operator does not reply (5490: "I will not answer questions or arbitrate") and the run ends.

## Attribution

Data: "yoars" corpus, Zenodo record 23755352 v1.0.1, CC BY 4.0 (https://zenodo.org/records/23755352), run `deepseek-flash-225035`. Changes: flattened, trimmed and re-shaped as described above. The adapter and the findings are delta-zero's.
