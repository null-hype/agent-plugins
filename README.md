# delta-pkl

A Delta thread summary as a Pkl module, with what the summary lost shown as
Witness diagnostics.

    python3 -I pkl_thread.py <thread> <out>      # delta thread show, twice
    pkl eval <out>/thread.pkl                     # the module type-checks
    cd <out> && nvim thread.pkl                   # with witness.lua loaded

`thread.pkl` amends `Thread.pkl`: the summary's blocks verbatim, plus each
full message's number, size and the block that carries it (null = dropped).
`<out>/.witness/run/findings.json` holds one finding per loss, and each
finding's evidence is the full text that was lost (go-to-definition opens it).

Severities: error = paragraph cut mid-sentence; warning = whole message not
in the summary, or the summary is marked stale; information = paragraphs
missing from a block that was kept (tool output counted too).

Loss detection is a paragraph-presence heuristic, not a semantic check.
