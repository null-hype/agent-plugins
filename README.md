# delta-pkl

A Delta thread summary as a Pkl module, with what the summary lost shown as
Witness diagnostics.

    python3 -I pkl_thread.py <thread> <out>      # delta thread show, twice
    pkl eval <out>/thread.pkl                     # the module type-checks
    nvim -u editor/init.lua <out>/thread.pkl      # witness attached to pkl
    nvim --headless -u editor/init.lua -c 'edit thread.pkl' -c 'luafile editor/check.lua'  # from <out>

`thread.pkl` amends `Thread.pkl`: the summary's blocks verbatim, plus each
full message's number, size and the block that carries it (null = dropped).
`<out>/.witness/run/findings.json` holds one finding per loss, and each
finding's evidence is the full text that was lost (go-to-definition opens it).

Diagnostic messages quote the first ~60 characters of the first lost paragraph
(`+N more` when several), e.g. `message 3 (user) dropped prose: "Do not deploy
this to production until I have reviewed the d…"`. A lost paragraph whose lines
mostly look like a command, `[tool]` line, timestamp, test id or pass/fail line
is labelled `log/tool output`, otherwise `prose`; that is a line-shape
heuristic, not a judgment of importance. Sizes in KB are shown only for
messages of 1 KB or more. Evidence files keep the original line breaks.

Severities: error = paragraph cut mid-sentence; warning = whole message not
in the summary, or the summary is marked stale; information = paragraphs
missing from a block that was kept (tool output counted too).

Loss detection is a paragraph-presence heuristic, not a semantic check.
