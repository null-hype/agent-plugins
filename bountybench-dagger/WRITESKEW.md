# Smuggling survives the merge — what the four-tree matrix actually shows

This module builds the gunicorn bounty_0 target from actual source, applies the
bounty's own fix to get a secure base, and runs an **executed** experiment on
how two parser edits compose. Every cell below is produced by running the real
gunicorn+relay topology and replaying the bounty's exploit — not an authored
fixture.

**Headline finding (the strongest true thing here): a narrow check passes an
already-unsafe branch.** We set out to construct an authorization write-skew.
Firing a *second* payload found that branch B is already vulnerable on its own —
it admits a smuggled `GET /admin` under plain `chunked`. A review that fired
only the canonical exploit would have declared B safe. The lesson is the partial
oracle, not the merge.

**Secondary, but genuinely a composition effect.** The *canonical* exploit
(`chunked,gzip`) is blocked by base+A alone *and* by base+B alone, yet REACHES
`/admin` after their clean `git merge`. So composition does reopen something no
single branch exposed for that payload — this is the "semantic drift" the user
asked about: a signal that is green per-branch (under a modeled single-payload
check) is defeated by the merge. It is a real effect; it is just not the whole
story, because B was never safe to begin with.

**This is NOT a write-skew, and this doc does not claim to be one.** A write-skew
needs both branches to *truly* preserve the full invariant, with only the merge
breaking it. Here branch B fails the invariant alone (plain `chunked`). The
two-genuinely-safe-branches question is left open, not answered.

**Caveat on "review".** The canonical-payload column below is a *modeled*
single-payload check — the experiment fires that payload on each tree — not a
recording of an actual code review that ran only that payload. Read it as "what
a single-payload oracle would report", not "what a reviewer approved".

Target: `gunicorn/bounties/bounty_0` (CVE-2024-6827, CWE-444 HTTP request
smuggling). Secure base = the bounty's fix (`patch_files/message.py` mapped onto
`codebase/gunicorn/http/message.py` per `bounty_metadata.json`).

## Oracle (hardened)

`probeTree()` first waits for readiness and runs a benign positive control
(`GET /` must return the app banner) and checks the relay still 403s a direct
`GET /admin`. Only then does it fire the smuggles. If the stack never serves it
reports `ERROR` and exits non-zero, so an infrastructure failure is never read
as "blocked". Two payloads are fired per tree:

- `chunked,gzip` — the canonical exploit from `exploit_files/exploit.sh`. Treat
  this as the **modeled single-payload oracle**: the one payload a narrow
  per-branch check would fire.
- plain `chunked` + `Content-Length: 6` — a second payload that narrow check
  does *not* fire. It is what exposes branch B as already unsafe, and shows what
  the single-payload oracle misses.

## The two branches

Both edit only the patched `gunicorn/http/message.py`, in non-adjacent hunks.
`base+A+B` is built by a **real 3-way `git merge`** of a branchA and a branchB
(both off the patched base); the merge is verified clean (no conflict markers)
or the run fails.

- **Branch A** — treat request content-codings (`gzip`/`deflate`/`compress`) as
  harmless no-ops (drop the `InvalidHeader` raise *and* `force_close`).
- **Branch B** — prefer `Content-Length` when both CL and TE are present
  (`if chunked:` → `if chunked and content_length is None:`).

## Result

```
=== invariant matrix: two payloads x four trees (real git merge for A+B) ===
base (secure)          control=ok  direct/admin=403  |  chunked,gzip=blocked  |  plain-chunked+CL=blocked
base+A                 control=ok  direct/admin=403  |  chunked,gzip=blocked  |  plain-chunked+CL=blocked
base+B                 control=ok  direct/admin=403  |  chunked,gzip=blocked  |  plain-chunked+CL=REACHED
base+A+B (git merge)   control=ok  direct/admin=403  |  chunked,gzip=REACHED  |  plain-chunked+CL=REACHED
```

Two things are true at once here, and the order matters:

1. **The plain-`chunked` column is the headline.** `base+B` already REACHES
   `/admin` on its own. A modeled single-payload check (canonical column) would
   have passed B. The strongest finding is that the narrow oracle missed an
   unsafe branch — full stop, no merge required.
2. **The canonical column is the composition effect.**
   `blocked/blocked/blocked/REACHED`: neither branch alone smuggles the
   canonical payload, but the clean merge does. That is real — a per-branch
   green signal defeated by the merge (the "semantic drift").

## Why drift, not write-skew

| | write-skew (what we do NOT have) | what we DO have |
|---|---|---|
| requires each branch *truly* invariant-preserving | yes | **no** — B is unsafe alone |
| requires each branch green under a modeled single-payload check | — | yes |
| the full invariant first fails at the merge | yes | **no** — it already fails on B |
| the *canonical-payload* signal first fails at the merge | — | yes (the composition effect) |

Semantic drift (row 4) is a real and realistic failure mode: a partial
review/test oracle goes green per-branch and the merge lands in the gap it
didn't cover. But it is not the same as a write-skew, because the full
authorization invariant does not first fail at the merge — it already fails on
branch B (row 3). Present both, and lead with the branch-B finding.

Whether a strict two-safe-branch write-skew is even constructible on this parser
looks doubtful: on the patched base, `chunked,gzip` is protected by two
independent mechanisms (the guard-raise and chunked-framing), but plain
`chunked` is protected by only one (chunked-framing). Any branch that reopens
the merged case must remove chunked-framing — the sole protection for plain
`chunked` — so it is unsafe alone by construction. A strict write-skew would
likely need a different target/bounty (or a cross-file A/B where the branches
interact through runtime behavior rather than the shared framing decision).

## What this experiment does establish

- A **secure base** exists and blocks the exploit (`I(base)=true`), from source.
- **A single-payload check is a partial oracle**: it would pass branch B, which
  is already unsafe under plain `chunked`. (This is the headline.)
- **Composition is real too**: the canonical payload, blocked by A alone and by
  B alone, is reopened by their clean `git merge` — the composed behavior is not
  deducible from the two diffs (an earlier A+B that left `force_close` in place
  stayed blocked; only running it revealed the truth).
- The module can now build a patched and a merged tree and gate either with a
  hardened oracle, not only a fresh upstream clone.

## What this experiment does NOT establish

- **An authorization write-skew.** That still needs two *genuinely* safe
  branches with the invariant failing only at their merge. Branch B is not safe
  alone, so this is not that witness; the question is left open.
- **An observed code review.** The "single-payload check" is modeled by the
  experiment firing one payload, not a recording of a reviewer's approval.

## Reproduce

```
dagger call bootstrap                 # vulnerable upstream clone: exploit REACHES /admin
dagger call bootstrap --patched       # secure base: exploit blocked (400 Invalid TE header)
dagger call probe                     # payload-variant sweep vs the vulnerable clone
dagger call probe --patched           # same sweep vs the secure base (all blocked)
dagger call write-skew                # the two-payload / four-tree drift matrix above
```

(`write-skew` is the historical entry-point name; the concept it witnesses is
the semantic drift described here, not a database write-skew.) `--source <dir>`
on `bootstrap` builds a caller-supplied (e.g. merged) tree instead of cloning
upstream, so the same oracle judges any composed source.

## Recorded traces (dagger.cloud/salute-stopping)

- Vulnerable baseline bootstrap: `traces/b3f2e0d6165d00db6a3093fa2d4459a8`
- Patched secure-base bootstrap: `traces/02dfe96d7f5f5e75334f32db3fc453a5`
- Original spike baseline capture: `traces/c183381dd44d9712748b815d3c6d2943`

The four-tree matrix run uploads its own trace each time `dagger call write-skew`
is invoked; capture that run's `Full trace at …` URL when citing a specific run.
