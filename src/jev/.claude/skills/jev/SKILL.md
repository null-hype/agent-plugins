---
name: jev
description: >-
  Use the installed `jev` client to send a fixture `state` and a set of Noul
  questions to TypeSafe's Jev judge and get one probability in [0,1] per
  question. Use when running the reasoning-model → Jev method contract: the
  capture → validate → jev → probabilities chain. Covers the state-only rule,
  the mock and real backends, and wrapping the API key with pass-cli.
---

# jev — the Noul-judge client

`jev` is the tail of the method chain. Upstream features produce state
(playwright-cli traces, restic snapshot diffs) and `evidence-validate` (the
`evidence` feature) checks the reasoning agent's evidence; `jev` then sends the
fixture `state` to TypeSafe's Jev judge and returns one probability in `[0, 1]`
per Noul question. `jev` deliberately does **not** capture state — it consumes
what upstream produced and keeps `state` opaque.

## Interface

```
jev [--backend real|mock] [--mock-answers FILE] [--print-request] \
    -q QUESTIONS.json  FIXTURE_OR_STATE
```

- `FIXTURE_OR_STATE` — a fixture `{meta?, state, expected?}` (only `.state` is
  sent) or a bare state document; `-` reads stdin.
- `-q/--questions` — a JSON object keyed by question id, each
  `{ "type": "noul", "instructions": "...", "criteria"?: {...} }`.
- Output — `{ "backend", "model", "probabilities": { id: <0..1> } }`, exactly
  the input question ids.

## The load-bearing rule: only `state` is sent

A fixture separates harness-only `meta` / `expected` (including
`expected.rationale`, which names the real CVE) from `state`. **Only `state` may
reach the model** — a leak silently voids the experiment. When the document has
a top-level `state` key, `jev` sends only that value and drops `meta`/`expected`.
Before any real call, verify with:

```
jev --print-request -q questions.json fixture.json   # prints the exact body, calls nothing
```

Confirm no harness-only marker (a CVE name, an `expected` value) appears in the
printed request.

## Backends — probabilities are never invented

- **real** (default) needs `TYPESAFE_API_KEY` in the environment. Never put the
  key in argv or bake it into an image; wrap the call with pass-cli:

  ```
  pass-cli run --env-file <f> -- jev --backend real -q questions.json fixture.json
  ```

  With no key the real backend fails loudly rather than guessing.
- **mock** returns only what `--mock-answers FILE` provides (a `{id: prob}` map
  or a full `{"answers": {...}}` response). `--backend mock` without
  `--mock-answers` is an error — the mock never fabricates a probability either.

## Contract `jev` enforces before any backend call

- Each question must be `type == "noul"` with a non-empty `instructions` string;
  malformed questions are rejected **before** the backend is called.
- Every returned probability must be a finite number in `[0, 1]`; the answer ids
  must match the question ids exactly. Out-of-range or non-finite answers are
  rejected.

## Where this fits

Deterministic contract scenarios (CIT-286) drive `jev` with canned evidence and
the mock backend; one live smoke runs a real agent and a real Jev call on the
toy case (CIT-285). What `state` should be for the reasoning-model → Jev contract
(the `{diff_items, files}` shape the Noul questions assume vs. the evidence
`{findings}` shape) is a CIT-286 decision; this client keeps `state` opaque and
passes it through untouched.

> If TypeSafe publishes a fixed API-key env var name, change it in the `jev` bin,
> this skill, and `src/jev/NOTES.md` together (currently `TYPESAFE_API_KEY`).
