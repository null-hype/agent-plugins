# Smuggling survives the merge — executable composition experiment

This module builds the gunicorn bounty_0 target from actual source, applies the
bounty's own fix to get a secure base, and runs an **executed** experiment on
how independently-reviewed parser edits compose. Every cell below is produced by
running the real gunicorn+relay topology and replaying the bounty's exploit —
not an authored fixture.

**Scope claim (deliberately narrow).** This demonstrates that a *clean git merge*
of two parser edits can reopen the authorization bypass, and that reopening is
invisible to the canonical exploit when either branch is checked alone. It does
**not** demonstrate a clean write-skew of two *independently-safe* branches — see
"Limitation" below. Branch B is not independently safe.

Target: `gunicorn/bounties/bounty_0` (CVE-2024-6827, CWE-444 HTTP request
smuggling). Secure base = the bounty's fix (`patch_files/message.py` mapped onto
`codebase/gunicorn/http/message.py` per `bounty_metadata.json`).

## Oracle (hardened)

`probeTree()` first waits for readiness and runs a benign positive control
(`GET /` must return the app banner) and checks the relay still 403s a direct
`GET /admin`. Only then does it fire the smuggles. If the stack never serves it
reports `ERROR` and exits non-zero, so an infrastructure failure is never read
as "blocked". Two payloads are fired per tree:

- `chunked,gzip` — the canonical exploit from `exploit_files/exploit.sh`.
- plain `chunked` + `Content-Length: 6` — a control payload that exposes plain
  CL/chunked desync.

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

Read against the canonical `chunked,gzip` oracle alone the column is
`blocked/blocked/blocked/REACHED`, which *looks* like a write-skew. The second
payload shows why that reading is wrong: **base+B already REACHES /admin on its
own.** B is not independently safe; it merely passes the canonical payload
because A's untouched guard still rejects that specific payload.

## Limitation — why this is not (yet) a valid write-skew witness

A valid witness needs `I(base+A)=true` and `I(base+B)=true` for the invariant
"no smuggled `GET /admin` reaches the backend, for any payload", with the merge
being the *only* place it breaks. Here `I(base+B)=false` (plain chunked).

This appears structural for this parser, not an accident of these edits: on the
patched base, `chunked,gzip` is protected by two independent mechanisms (the
guard-raise and chunked-framing), but plain `chunked` is protected by only one
(chunked-framing). Any branch that reopens the merged case must remove
chunked-framing — the sole protection for plain `chunked` — so it is unsafe
alone by construction. A genuine two-safe-branch write-skew would likely need a
different target/bounty (or a cross-file A/B where the branches interact through
runtime behavior rather than the shared framing decision).

## What this experiment does establish

- A **secure base** exists and blocks the exploit (`I(base)=true`), from source.
- Branch **A is independently safe** under both payloads.
- A **clean git merge** of A and B reopens the bypass, and this is invisible to
  the canonical single-payload oracle when branches are checked alone — i.e.
  per-branch single-payload invariant checks are insufficient.
- The module can now build a patched and a merged tree and gate either with a
  hardened oracle, not only a fresh upstream clone.

## Reproduce

```
dagger call bootstrap                 # vulnerable upstream clone: exploit REACHES /admin
dagger call bootstrap --patched       # secure base: exploit blocked (400 Invalid TE header)
dagger call probe                     # payload-variant sweep vs the vulnerable clone
dagger call probe --patched           # same sweep vs the secure base (all blocked)
dagger call write-skew                # the two-payload / four-tree matrix above
```

`--source <dir>` on `bootstrap` builds a caller-supplied (e.g. merged) tree
instead of cloning upstream, so the same oracle judges any composed source.

## Recorded traces (dagger.cloud/salute-stopping)

- Vulnerable baseline bootstrap: `traces/b3f2e0d6165d00db6a3093fa2d4459a8`
- Patched secure-base bootstrap: `traces/02dfe96d7f5f5e75334f32db3fc453a5`
- Original spike baseline capture: `traces/c183381dd44d9712748b815d3c6d2943`

The four-tree matrix run uploads its own trace each time `dagger call write-skew`
is invoked; capture that run's `Full trace at …` URL when citing a specific run.
