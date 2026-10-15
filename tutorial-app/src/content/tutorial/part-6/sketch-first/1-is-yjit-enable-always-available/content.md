---
type: lesson
title: Is RubyVM::YJIT.enable always available
editor: false
previews: false
terminal: false
---

# Is the method always available?

Rails commit `fddf74bea9` removed a `defined?` guard. Its message says
`RubyVM::YJIT.enable` "is always available" now that Rails requires Ruby 3.3.0. Rails
reverted the change in
[#56533](https://github.com/rails/rails/pull/56533).

Before running anything, I drew what a reviewer should see when a linter flags
that sentence. Then a check compared every element of the drawing with the
evidence. The drawing has two versions.

## The plan

<figure class="sketch-frames">
  <a href="/sketches/fddf74bea9/plan.svg"><img src="/sketches/fddf74bea9/plan.svg" alt="Black-and-white sketch of the commit message in an editor: two highlighted lines, a Vale alert on &quot;always&quot;, a question, a score of Jev 0.38, Peek yes and Peek no buttons, and a payload digest sha256:9f2c." /></a>
  <figcaption>Black and white is the plan. It is drawn before the run, and it is the only part a person edits.</figcaption>
</figure>

## What the check found

<figure class="sketch-frames">
  <a href="/sketches/fddf74bea9/checked.svg"><img src="/sketches/fddf74bea9/checked.svg" alt="The same sketch coloured by the check. The commit text, highlights and Vale alert are green. The question, score and Peek buttons stay black. The payload digest is red and struck through. Two things the sketch leaves out are listed in orange." /></a>
  <figcaption>Colour is what the check found. <code>Frame.pkl</code> marks each element from the case's evidence: the commit, Vale's alerts, Jev recordings and snapshots.</figcaption>
</figure>

| Element | Status | Why |
| --- | --- | --- |
| Subject line | proven | It matches line 1 of the commit. |
| Highlighted sentence | proven | It is lines 3 and 4 of the commit, joined. |
| Highlight on "always" | proven | Vale flags it. |
| Highlight on "no longer" | proven | Vale flags it. |
| `vale Claims.Absolute line 4 "always"` | proven | Vale reports exactly this. |
| The question "Is RubyVM::YJIT.enable always available" | unproven | I wrote it by hand. Nothing in the run turns the flagged span into it. |
| "Jev 0.38 that it holds" | unproven | There are no Jev recordings yet. |
| Peek: yes and Peek: no | unproven | There are no snapshots, and nothing in the run produces them. |
| Payload digest `sha256:9f2c..` | contradicted | The real payloads hash to `09d0b637…`, `9baa2373…` and `09cc00d2…`. |

The sketch also leaves two things out:

- Vale flags "unnecessary" on line 1 as well.
- "always" and "no longer" are on one line of the real message. The sketch draws two.

## What that means

The drawing promised a score, two peek states and a pinned digest. So far the
evidence supports the text and the linter's highlights, and nothing more. The
digest in the sketch was made up, and the check says so. The score and the peek
buttons stay black until the Jev call and the snapshots exist.

A mockup with invented numbers looks finished. Drawing it first, then letting a
check colour it, is how the gaps showed up before anyone built the feature.

## Run it yourself

From `tutorial-app/src/lesson-farms/rails-claims`:

```sh
pkl eval -f json -p hash=fddf74bea9 Frame.pkl            # the verdicts
pkl eval -p hash=fddf74bea9 -p row=plan Scene.pkl > plan.svg
pkl eval -p hash=fddf74bea9 -p row=checked Scene.pkl > checked.svg
```

`railsClaims.spec.ts` fails if either published frame, or this lesson's
table, stops matching what `Frame.pkl` computes.
