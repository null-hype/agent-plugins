# Jev client

Install the Jev command and its Pkl request/response types. It accepts state
and Noul questions, returning one probability per question. Case features
own their evidence and expectations; see [NOTES.md](NOTES.md).

```json
"features": {
    "ghcr.io/null-hype/agent-plugins/jev:0": {}
}
```

```bash
jev --backend mock --mock-answers answers.json -q questions.json state.json
jev --print-request -q questions.json state.json
```

The real backend reads `TYPESAFE_API_KEY` at invocation time. No key is baked
into the feature.
