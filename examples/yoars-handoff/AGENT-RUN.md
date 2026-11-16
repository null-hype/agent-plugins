# Agent run: handoff 5484 (backend to ui)

Question: with delta-zero in the loop, does the receiving agent itself surface the dropped decision (an empty or unknown unit gets `gauge=""` and passes through unscaled; the handoff says only "plain pass"), with no human reading the findings?

Receiver: Claude (`claude -p`), told it is the ui agent, given the handoff text. One run each, no repeats, so this shows what can happen, not how often. Raw prompts and replies are in `agent-run/`.

## Commands

With the skill (the task tells the agent to use `check-summary-loss` before acting, and points at the pair):

    claude --plugin-dir ~/projects/delta-zero --allowedTools "Bash(python3:*),Bash(pkl:*)" -p "$(cat agent-run/task1b-with.txt)"

Without (plain `claude -p`, the handoff text only, no tools, no plugin):

    claude -p "$(cat agent-run/task1b-without.txt)"

`task1b` asks: "describe how report.py must treat each kind of input line that reaches it from normalize()". `task1` (first pair of runs) additionally asked "what report.py should assume for every value of the unit label"; that wording leads toward the gap, so read those runs as a weaker test. Both are kept.

## Result

delta-zero reported 39 findings. The agent read the evidence, picked the ones that matter, quoted the empty-unit decision and did not confirm the handoff.

With the skill, `task1b` (verbatim):

> **What happens with an empty gauge.** The code in `transform.py` says *"'plain' (and '' before a drop) pass through unchanged."* The backend assumed this case "will be dropped anyway since epoch/person empty". The code doesn't do that. A key=value line with a valid person and time but a missing or unknown `u=` gets **kept, with `worth` not converted**.

> | key=value, other or missing `u` | Kept, **`worth` not converted** | The handoff doesn't cover this. Ask the backend and auth agents whether it should be dropped. Don't silently count it. |

> **Next step:** reply to the backend that I can build from those six fields, but only once the empty-gauge and non-numeric-amount cases are settled.

With the skill, `task1`: it listed "`gauge = "plain" if unit == "E" else "hundredths" if unit == "C" else ""` ... creates a fourth unit state, the empty string, which the handoff never mentions", and ended "I haven't written report.py or replied 'confirmed' to backend ... Do you want me to send those two messages, or reply 'confirmed' with these caveats attached?"

Without the skill, `task1b` (verbatim, question 4 of 4 for backend):

> **Unknown gauge value:** is the row passed through unscaled, dropped, or does it raise an error?

Without the skill, `task1`: "The handoff doesn't say what happens with any other gauge value (a typo, different case, empty, or missing). Such a record might pass through unscaled, be dropped, or raise an error."

## Reading

- With delta-zero, the agent stated the decision as a fact, quoted it from the backend's own code and reasoning (findings `m35-dropped`, `m36-dropped`; the 39 findings were not read by a human), said the handoff left it out, and held back its confirmation. No human noticed anything.
- Without it, the agent also stopped and asked, and it guessed the gap: "passed through unscaled, dropped, or raise an error". It did not know which, so the answer stays open until backend replies. The baseline is not a straw man; the difference is that the delta-zero agent had the answer and the quote.
- The 39 findings did not drown it here: it ranked them and named four. It also found two things nobody had listed: JSON `scaled:true` may not match what auth emits, and a non-numeric `worth` raises instead of returning `None`. Those are the agent's reading of the code, not checked against a run.
- The agent in `task1b` repeated the backend's own misjudgement as a caution: the backend assumed such lines would be dropped; the code keeps them.

Limits: one run per arm and task; the receiver was told to run the skill (the plugin's skill description would also trigger it, but that was not tested); the receiver is Claude, not the corpus's DeepSeek agents; the handoff here is from a run that passed its acceptance 6/6, so nothing downstream broke.
