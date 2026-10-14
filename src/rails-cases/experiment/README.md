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

