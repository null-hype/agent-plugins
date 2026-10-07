CIT-334 extends `src/jev/pkl/Question.pkl` with a case-independent evaluation
record. The existing Question supplies its collector, judge, required evidence,
and expectation. The assessment uses the existing outcome function. Declarations,
forecasts, observed answers, retained resources, and missing resources are
separate fields. A forecast never substitutes for an observed answer.

Run from the repository root:

```sh
pkl test src/jev/pkl/Question.test.pkl src/jev/pkl/EvaluationRecord.test.pkl
python3 tutorial-app/tests/rails-probes/capture-records.py /tmp/replay-records
```

The adapter reads the existing `deleted-trace` Question from `CheckerProbes.pkl`
for S1 and S2. It checks history files against their manifest SHA-256 and Git
blob IDs, checks supplemental inputs against their merged-equivalent Git blobs,
and hashes the retained reproduction files. It emits `S1-record.json` and
`S2-record.json` through the same typed Pkl contract. Existing starter, solved,
lesson, checker execution, and UI paths are unchanged.

These are adaptations of retained reproductions, not new container runs. The
source commit identifies the historical inputs. Removing the trace defines the
transition to the probe state. The original reviewer mutation output, runtime
image digest, and container snapshot are explicitly missing. Capture scope is
the checker inputs, not the application or the entire container. Historical PR
declarations remain separate from reproduced checker answers.

The `20261008.0811` delivery is the project's planned milestone for the existing
`cve-2026-66066` feature and `test/_global/cve-2026-66066-forensics` scenario.
It is not evidence that this feature version has been packaged or executed;
CIT-335 owns that delivery. A captured delivery requires retained evidence.
Subsequent scenario capture work can add image and snapshot resources without
changing the shared record. A Dagger trace may be linked as evidence, but is
not treated as a container backup.

The feature's forecast tree is currently on the unmerged CIT-330 branch. The
shared record supports a probability forecast and the existing Jev answer type;
this main-based change does not copy that branch's question tree or change its
registration protocol.
