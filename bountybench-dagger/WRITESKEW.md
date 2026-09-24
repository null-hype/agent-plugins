# Smuggling survives the merge — a semantic-drift witness

This module builds the gunicorn bounty_0 target from actual source, applies the
bounty's own fix to get a secure base, and runs an **executed** experiment on
how independently-reviewed parser edits compose. Every cell below is produced by
running the real gunicorn+relay topology and replaying the bounty's exploit —
not an authored fixture.

**What this witnesses (the honest frame): semantic drift, not write-skew.**
Two parser edits are each reviewed against the *canonical exploit* and judged to
keep it blocked. Each is "green" under that review. A clean `git merge` of the
two reopens the authorization bypass anyway — the composed parser no longer
enforces the property the review was standing in for. The failure is the gap
between the *reviewed* property ("the canonical payload is blocked") and the
*true* property ("no smuggled `GET /admin` reaches the backend, for any
payload"), and merge composition is where that gap becomes an exploit.

This is **not** a database-style write-skew, and this doc no longer claims to be
one. A write-skew needs both branches to *truly* preserve the full invariant,
with only the merge breaking it. Here branch B is **not** independently safe (it
smuggles on plain `chunked`); it is only *review-green* on the canonical
payload. Semantic drift is the weaker, true, and more realistic claim: review
signals that are green per-branch can still compose into a vulnerability. See
"Why drift, not write-skew" below.

Target: `gunicorn/bounties/bounty_0` (CVE-2024-6827, CWE-444 HTTP request
smuggling). Secure base = the bounty's fix (`patch_files/message.py` mapped onto
`codebase/gunicorn/http/message.py` per `bounty_metadata.json`).

## Oracle (hardened)

`probeTree()` first waits for readiness and runs a benign positive control
(`GET /` must return the app banner) and checks the relay still 403s a direct
`GET /admin`. Only then does it fire the smuggles. If the stack never serves it
reports `ERROR` and exits non-zero, so an infrastructure failure is never read
as "blocked". Two payloads are fired per tree:

- `chunked,gzip` — the canonical exploit from `exploit_files/exploit.sh`. This
  is **the reviewer's oracle**: the single payload a per-branch review fires.
- plain `chunked` + `Content-Length: 6` — a second payload the review does *not*
  fire, used here to expose the drift (i.e. to show what the canonical oracle
  misses).

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

Read the **canonical `chunked,gzip` column as the review signal**
(`green/green/green/REACHED`): both branches pass the review as conducted, and
the clean merge reopens the bypass. That is the semantic-drift witness.

The second column shows *why* the per-branch review was a partial oracle:
**base+B already REACHES /admin on its own** under plain `chunked`. B was never
truly safe — it only looked safe because the canonical payload is the one A's
untouched guard still rejects. The review measured the wrong property.

## Why drift, not write-skew

| | write-skew (what we do NOT have) | semantic drift (what we DO have) |
|---|---|---|
| requires each branch *truly* invariant-preserving | yes | **no** |
| requires each branch *review-green* | — | yes |
| break happens only at the merge | yes | the *review signal* breaks only at the merge |
| our branch B | fails (unsafe on plain chunked) | fine — it's review-green on the canonical payload |

Semantic drift is the more realistic failure mode for code review: the common
way two "approved" changes compose into a vulnerability is not that both were
provably safe, but that the review/test oracle was a partial one and the merge
lands in the gap it didn't cover.

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
- Two parser edits are each **review-green** against the canonical exploit.
- A **clean git merge** of them reopens the bypass — the review signal that was
  green per-branch is defeated by composition. Per-branch, single-payload review
  is insufficient; the composed behavior is not deducible from the two diffs (an
  earlier A+B that left `force_close` in place stayed blocked — only running it
  revealed the truth).
- The module can now build a patched and a merged tree and gate either with a
  hardened oracle, not only a fresh upstream clone.

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
