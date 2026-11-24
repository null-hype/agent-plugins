# delta-zero (Δ0)

**Compiler warnings for context loss.**

*More difference, less inference.*

The user wrote: "Go ahead and implement it and add the tests. Do not deploy this to production until I have reviewed the diff myself." The agent's summary kept the first sentence and dropped the second. delta-zero quotes the dropped sentence back before the agent acts. It flags; it does not block.

    claude --plugin-dir . --allowedTools "Bash(python3:*),Bash(pkl:*)" -p "Check examples/deploy-approval for summary loss, then deploy the change"

![A headless Claude Code run: the agent checks the summary, finds the dropped "do not deploy" sentence, and stops to ask instead of deploying.](examples/deploy-approval/hero.png)

*The summary read as permission to ship. The thread said wait.* The agent's reply from one real run on the synthetic thread in `examples/deploy-approval` (cuts marked `…`): told to deploy, it did not, quoted the dropped sentence and asked whether it still holds.

**On real data** (a public four-agent data-pipeline build, [yoars corpus, CC BY 4.0](examples/yoars-handoff/AGENT-RUN.md)): the backend agent decided that a line with an unknown or empty unit label passes through unscaled, and its handoff to the ui agent said only "plain pass". The run passed its acceptance check 6/6, so no test caught it. We replayed the handoff, one run each. With the plugin, the receiving agent ran the check, found the decision among 39 findings, quoted it ("'plain' (and '' before a drop) pass through unchanged") and held back its confirmation. Without it, the agent only asked what happens to an unknown unit. Nobody read the findings by hand.

## How it works

delta-zero reads a thread's summary and the full thread, and flags every paragraph that is in the full text but not the summary. Each flag quotes the lost text and links to its source, like a compiler warning.

- **Delta** holds threads and summaries. delta-zero reads its `thread show` output (summarize and full formats). It does not present threads; Delta and Zed do that.
- **Pkl** gives the summary a type. `thread.pkl` keeps the summary's blocks verbatim and records each full message's number, size and the block that carries it (`null` means dropped).
- **Witness** reads `.witness/run/findings.json` and shows each finding as a diagnostic, with go-to-definition into the lost text and a stale-source marker.

A diagnostic quotes the first ~60 characters of the first lost paragraph. Severity: error means a paragraph was cut mid-sentence; warning means a whole message is not in the summary, or the summary is stale; information means paragraphs are missing from a block that was kept. A lost paragraph whose lines mostly look like a command, a `[tool]` line, a timestamp, a test id or a pass/fail line is labelled `log/tool output`, otherwise `prose`.

The same finding in an editor, cropped to the diagnostics (Neovim with the Witness language server): `message 3 (user) dropped prose: "Do not deploy this to production until I have reviewed the d…"`.

![Neovim: a diagnostic on the approval block quotes the sentence the summary dropped.](examples/deploy-approval/screenshot-diagnostic.png)

[With the sentence restored by hand](examples/deploy-approval/screenshot-repaired.png), that finding is gone; the remaining one is a pytest log, labelled `log/tool output`, and dropping it was right. An animated version is [`public/delta-zero-demo.gif`](public/delta-zero-demo.gif).

## Try it without Claude Code

No Delta needed. You need Python 3 and [Pkl](https://pkl-lang.org). For the editor view you also need Neovim 0.11+ and the [Witness](https://github.com/null-hype/witness) language server (`witness`) on your PATH. The example is a synthetic 8-message thread (a retry-backoff change to a billing webhook), stored as two JSON files in the shape Delta prints.

    cd examples/deploy-approval
    python3 -I ../../pkl_thread.py --summarize summarize.json --full full.json out
    pkl eval out/thread.pkl > /dev/null          # the summary is a type-checked Pkl module
    cat out/.witness/run/findings.json           # two findings, one per lost paragraph
    cd out && nvim -u ../../../editor/init.lua thread.pkl

Go to line 27 and read the diagnostic. Run `:lua vim.lsp.buf.definition()` there to open the full lost sentence (`.witness/run/evidence/m3-partial.txt`).

Then restore the sentence by hand. `summarize-repaired.json` differs by one sentence in block 2:

    cd ..
    python3 -I ../../pkl_thread.py --summarize summarize-repaired.json --full full.json out-repaired
    nvim -u ../../editor/init.lua out-repaired/thread.pkl

Now only the pytest-log finding remains (line 33). With Delta installed, `python3 -I pkl_thread.py <thread> <out>` does the same on a real thread.

## Install as a plugin

delta-zero is an [Agent Plugins](https://agent-plugins.org) 1.0 plugin (`plugin.json` plus the skill `skills/check-summary-loss`), validated against the 1.0.0 schema. It runs in Claude Code and Codex and loads in VS Code, and needs Python 3 and Pkl on the host.

## What this is not yet

Detection is structural, not semantic: a reworded constraint is still flagged, and nothing ranks which loss matters. The two real handoffs gave 39 and 126 findings; in the one replayed, the agent ranked the 39 itself, but nothing in delta-zero does (the planned judgment layer, Jev). It cannot catch an agent misreading a handoff that kept the decision, and nothing forces an agent to heed a flag. Repair is manual.

## Where it comes from

Glossing *Fingerspitzengefühl* as "tact" drops four named axes (lexicalization, Gefühl register, Spitzen valence, lineage). Naming them makes the loss inspectable; a compacted agent context is the same problem with higher stakes. The lesson is in `tutorial-app/` of [null-hype/agent-plugins](https://github.com/null-hype/agent-plugins).

## Credits

- The [yoars corpus](https://zenodo.org/records/23755352) (Zenodo record 23755352, v1.0.1, CC BY 4.0) for the real multi-agent run.
- [Pkl](https://pkl-lang.org) for the typed summary, [Witness](https://github.com/null-hype/witness) for the language server, and [Neovim](https://neovim.io) for the screenshots.
- Delta, whose thread format this reads.
