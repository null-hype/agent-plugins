# jev — notes

Method-layer client for TypeSafe's Jev judge (CIT-289). Send a fixture `state`
and a set of Noul questions, get one probability in `[0, 1]` per question.
Consumed by CIT-275 (Jev fixture + negative control) and CIT-286 (the
reasoning-model → Jev contract scenarios); the toy case CIT-285 is its
live-smoke input.

## The composition is the point

A devcontainer is assembled from features, and the assembled container is the
Jev client. `jev` is the tail of a chain the other features already provide:

```
playwright-cli traces ─┐
                       ├─→ evidence-validate (CIT-284) ─→ jev ─→ {question_id: prob}
restic snapshot diffs ─┘        grounding check              this feature
(pass-cli / color)
```

`jev` deliberately does not capture state — it consumes whatever upstream
produced. `installsAfter` names `pass-cli` and `playwright-cli` so it *composes
with* them when present rather than forcing them in. The runtime secret is the
seam: `jev` reads `TYPESAFE_API_KEY` from the environment and knows nothing
about pass-cli; the caller supplies it with
`pass-cli run --env-file <f> -- jev ...`.

`pkl/Jev.pkl` owns the request contract, the sibling of
`tk-evidence-exporter/pkl/Evidence.pkl`. The bin builds every request through it
with the [pkl-python](https://github.com/jw-y/pkl-python) binding
(`pkl.load(..., expr="requestFromJson(...)")`) and reads the result as the
dataclasses generated from the same file (`jev_pkl.py`, registered on the
`pkl.Parser` namespace) — Python has no second copy of the rules. An invalid
request fails Pkl evaluation before any transport is invoked
(`test/jev/contract_test.py`). Python keeps transport, auth and serialization.
The response contract (`JevResponse`) is still enforced by hand in `jev` and is
the next change.

Regenerate the types after editing `Jev.pkl` (`pkl-gen-python` fetches its
generator package over HTTPS from GitHub; if that is blocked, unzip the
`pkl.python@<ver>.zip` release asset and point `generateScript` at its
`Generator.pkl` in a `--generator-settings` file):

```
pip install pkl-python==0.1.19
pkl-gen-python src/jev/pkl/Jev.pkl -o /tmp/gen && cp /tmp/gen/jev_pkl.py src/jev/jev_pkl.py
```

## What was verified vs. stubbed

Verified against `docs.typesafe.ai/api`:

- Endpoint/method: `POST https://api.typesafe.ai/v1/systemone`.
- Auth: `Authorization: Bearer <key>`.
- Request: `{ "state": ..., "model": "jev-latest", "questions": { id: {type,
  instructions, criteria?} } }`.
- Response: `{ "model", "answers": { id: { "type": "noul", "noul": <0..1> } },
  "usage" }`.

Chosen (docs did not fix it): the API-key env var name is `TYPESAFE_API_KEY`.
Change it here and in `jev`/`SKILL.md` together if TypeSafe publishes a name.

Untested: the **live** Jev call. There is no API key in this environment, and
Jev's output is model-dependent, so the client ships with a mock backend and the
real transport is exercised only by the contract scenarios (CIT-286) once a key
is available. The client never invents probabilities: the real backend with no
key fails loudly, and the mock returns only what a canned file provides.

## Open question for CIT-286: what is `state`?

The Noul questions (`docs/investigations/CIT-265/questions.json`) phrase
themselves as "the changes in `diff_items`, using the code in `files`" — i.e.
they expect a `{diff_items, files}` state. CIT-284 evidence is a different shape
(`{findings:[...]}`). So a reasoning agent's evidence output is **not** directly
the Jev `state`. The client keeps `state` opaque on purpose and passes it
through untouched; deciding whether CIT-286 feeds Jev the `{diff_items, files}`
state, or evidence-shaped questions, or an adapter between them, is a CIT-286
decision, not something this client should bake in.

## The "only state is sent" rule

Fixtures separate harness-only `meta`/`expected` (including
`expected.rationale`, which names the real CVE) from `state`; only `state` may
reach the model. `jev` enforces this: given a document with a top-level `state`
key it sends only that value. `jev --print-request` prints the exact outgoing
body without calling anything, and `test/jev/test.sh` asserts a `meta`/`expected`
marker never appears in it. This is the most load-bearing check in the feature —
a leak silently voids the hint-ladder experiment.
