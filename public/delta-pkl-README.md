# delta-pkl

**Show what a summary lost, on the line where it was lost.**

A summary is lossy by construction. In an agent workflow, compaction throws context away before the next action, and by default you cannot see what went. delta-pkl turns a thread and its summary into a typed [Pkl](https://pkl-lang.org) module and reports each loss as an editor diagnostic that quotes the dropped text, links to the full original, and can be repaired.

![Before: a diagnostic on the approval block](examples/deploy-approval/screenshot.png)

*Before.* The summary says "Go ahead and implement it and add the tests." Alone, that reads as permission to ship. The diagnostic on that block quotes what was dropped: `message 3 (user) dropped prose: "Do not deploy this to production until I have reviewed the d…"`.

![After: one sentence restored](examples/deploy-approval/screenshot-repaired.png)

*After.* One sentence restored to the summary and the finding is gone. The remaining one is a pytest log, labelled `log/tool output`, and dropping it was right.

The animated version (summary, go-to-definition on the evidence, repaired summary) is `public/delta-pkl-demo.gif`.

## The idea

Loss in a summary should be **named, visible, traceable to its source and repairable**, like a compiler warning. The ones that matter most are the distinctions that change the next action: "implement, but don't deploy."

It started from a language-learning lesson. *Fingerspitzengefühl* has no English equivalent, and the lesson names the axes of meaning a gloss like "tact" drops: lexicalization, Gefühl register, Spitzen valence, lineage. Compaction is the same problem.

## How it fits together

- **Delta** holds threads and summaries. delta-pkl reads its `thread show` output (summarize and full formats).
- **Pkl** gives the compressed knowledge a type (`Thread.pkl`). The summary's blocks are kept verbatim, and each full message records its number, size and the block that carries it (null means dropped).
- **[Witness](https://github.com/null-hype/witness)** is the language server. It reads `.witness/run/findings.json` and shows each finding in the editor, with go-to-definition into the evidence and a stale-source marker.

## Run it yourself (no Delta needed)

You need Python 3, [Pkl](https://pkl-lang.org), and for the editor view, Neovim 0.11+ with `witness` on PATH. The example is a synthetic 8-message thread (a retry-backoff change to a billing webhook) stored as two JSON files in the shape Delta prints.

    cd examples/deploy-approval
    python3 -I ../../pkl_thread.py --summarize summarize.json --full full.json out
    pkl eval out/thread.pkl > /dev/null          # the summary is a type-checked Pkl module
    cat out/.witness/run/findings.json           # two findings, one per lost paragraph
    cd out && nvim -u ../../../editor/init.lua thread.pkl

Go to line 27 and read the diagnostic. Run `:lua vim.lsp.buf.definition()` there to open the full lost sentence (`.witness/run/evidence/m3-partial.txt`).

Then repair it. `summarize-repaired.json` differs by one sentence in block 2:

    cd ..
    python3 -I ../../pkl_thread.py --summarize summarize-repaired.json --full full.json out-repaired
    nvim -u ../../editor/init.lua out-repaired/thread.pkl

Now only the pytest-log finding remains. `DEMO.md` has a two-minute spoken script. To rebuild the GIF from your own session, run `public/demo-gif/make.sh`.

With Delta installed, `python3 -I pkl_thread.py <thread> <out>` does the same on a real thread.

### What the diagnostics say

- error: a paragraph was cut mid-sentence.
- warning: a whole message is not in the summary, or the summary is marked stale.
- information: paragraphs are missing from a block that was kept.

Messages quote the first ~60 characters of the first lost paragraph. A lost paragraph whose lines mostly look like a command, a `[tool]` line, a timestamp, a test id or a pass/fail line is labelled `log/tool output`, otherwise `prose`. That is a line-shape heuristic, not a judgment of importance.

## What this is not yet

- **Not semantic.** Loss is found by checking whether each paragraph of the full message appears in the summary text. It has no notion of meaning. It cannot tell a constraint from a log, and a paraphrased constraint is still flagged as lost.
- **No judgment of which loss matters.** A person decides, in seconds, because the lost text is quoted. A judgment service (Jev) is planned for that and is not wired in.
- **No automated repair.** The repair in the demo is a sentence added by hand. Rewriting a summary to restore what matters is not built.
- **One synthetic example.** The demo is a constructed thread, not a measurement. There are no results on real workloads and no comparison with other compaction methods.
- **Not a Delta replacement.** It reads what Delta prints.

## The next experiment

Semantic coverage plus targeted repair, compared against plain re-summarising at the same token budget, measured by whether a fresh agent picks the correct next action. Designed, not run.
