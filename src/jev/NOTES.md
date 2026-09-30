# Jev client

Jev consumes a state document and Noul questions and returns numeric
probabilities. Each case owns its evidence, observations and expectations;
Jev keeps state opaque. The noteexpand feature's `with_jev` scenario is the
first connected example.

`pkl/Jev.pkl` owns the request and response types. The client loads them through
[pkl-python](https://github.com/jw-y/pkl-python) and the generated `jev_pkl.py`
dataclasses. Pkl checks question types, required fields, answer IDs and finite
probabilities in `[0,1]`. Python handles transport, authentication and
serialization. There are no generic confidence bands or case-specific verdicts
in this client.

The API uses `POST https://api.typesafe.ai/v1/systemone`, a bearer key in
`TYPESAFE_API_KEY`, and the request `{state, model, questions}`. Responses contain
`{model, answers, usage?}` with Noul scores. API keys are runtime credentials;
pass-cli may supply them with `pass-cli run --env-file <file> -- jev ...`.

The real backend requires a key. The mock backend requires a supplied answers
file; it does not invent scores. Default feature tests and the noteexpand
integration use mocks. No separate live workflow is installed.

When a fixture contains `state`, only that value is sent; harness-only
`meta`/`expected` stay local. `--print-request` inspects the outgoing body without
calling a backend. `--request-out FILE --response-out FILE` records the exact
request and raw response, including a response rejected by the Pkl contract.

Regenerate bindings after changing `Jev.pkl`:

```bash
pip install pkl-python==0.1.19
pkl-gen-python src/jev/pkl/Jev.pkl -o /tmp/jev-gen
cp /tmp/jev-gen/jev_pkl.py src/jev/jev_pkl.py
```

`test/jev/contract_test.py` checks generated request/response types with a
stubbed transport. Installation and command behavior are checked by
`devcontainer features test -f jev .`.
