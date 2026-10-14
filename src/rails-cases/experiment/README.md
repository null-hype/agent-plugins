# First proposer/challenger experiment

`Experiment.pkl` owns the claim, scope, observations, agent response types,
and prompts. `proposer` and `challenger` are separate installed features;
each accepts the experiment's Pkl-rendered request and starts a fresh Claude
turn. The roles have no tools or acceptance operation.

The first case uses **constructed** runtime observations around the Rails
YJIT availability claim. It tests the distinction between one working example
and availability across the entire stated scope. It does not establish facts
about real Ruby distributions. A positive control has both runtimes available;
the counterexample has only the first available. The proposer is asked to
express universal availability; the challenger must choose the probe that can
refute it. Humans still assess the quality of the question and alternative.

With the three features installed and Claude credentials supplied by the caller:

```sh
rails-experiment /cases/counterexample.pkl /output/new-proposal \
  --baseline /cases/counterexample-expected.pcf
```

The output directory must not exist. It receives the model responses, Pkl
checks, captured evidence, a candidate `Claim.test.pkl-expected.pcf`,
`expected.patch`, and a `review.json` with content hashes and a pending human
decision. The accepted file is only read. Exit 1 for this counterexample is the
expected disagreement, not permission to overwrite the accepted expectation.
The control exits 0. Invalid agent responses fail before candidate generation.

