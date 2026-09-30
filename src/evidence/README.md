# Evidence contract

`Evidence.pkl` defines the collector's evidence record. `pkl-python` loads it as
Python classes generated from the same module. `evidence-validate` adds real
filesystem grounding: the quotation must occur in its source file, and all
cited/supporting paths must remain under the supplied root, including symlinks.
No-findings is valid.

```sh
evidence-validate --root /path/to/snapshot evidence.json
```

`enforced` is the collector's claim. A grounded quotation verifies the quotation,
not the enforcement claim. `supporting_paths` names additional code files that
the projection includes in Jev's state alongside the cited rule. Jev types live
in the Jev feature; the evidence feature does not depend on its schema.

Installed: Pkl, the pinned Python binding in `/usr/local/lib/evidence/venv`,
modules in `/usr/local/share/evidence/pkl`, generated classes and filesystem
functions in `/usr/local/share/evidence/lib`, and `evidence-validate`.

## Concrete tests

The global shell scripts invoke their own `[scenario]_test.py` directly:

- `cit-286-contract`: typed evidence -> grounding -> installed mock Jev. Capture
  the exact request; reject malformed/ungrounded input with zero Jev invocations.
- `cit-286-toy-smoke`: execute the existing noteexpand canary against exported
  positive/control fixture roots. Reconcile a separate claim with the observed
  outside-file read using the case's `Reconcile.pkl`, as lesson 5 reconciles
  requests, grants and observations. A correctly reported outside read is the
  expected diagnostic; a false enforcement claim is a separate disagreement.

The canary maps only the expander executable's image-absolute path to the
exported fixture root. Preserved sources, executed script and output show what
ran. This establishes the scoped outside-file-read behavior, not all meanings
of the README's author rule, agent containment, or Rails CVE detection.

Each invocation creates a fresh record directory under `CONTRACT_RECORDS_DIR`.
The small `verdict_matcher.to_have_verdict` compares and records actual/expected
results on pass and failure. It owns no check semantics. Records include source
snapshots, claims, observations, exact Jev requests, raw responses, normalized
results and diagnostics. CI uploads these even on failure.

Confidence remains a numeric Jev observation. Any experiment-specific confidence
expectation belongs in that experiment's Pkl check; no default ordering,
threshold or confidence classification is supplied by the method.

## Live execution

Default tests always invoke mock Jev. The separate
`cit-286-toy-smoke_live.py` entry point invokes real Jev with a supplied evidence
file or an explicitly supplied collector executable. The manual
`experiment-live.yaml` calls it with recorded toy evidence. Credentials do not
change what a default test executes. Pass-cli may wrap the live invocation to
supply the key; model/hint/repeats are parameters of the live entry point.

Collector isolation and its trace remain runner requirements (CIT-271/CIT-288),
not a policy engine in this contract library. Collected evidence, runner-init
record, and each repeat's outputs are retained; a live run has not been performed
as part of this refactor.

Regenerate evidence types with `pkl-gen-python src/evidence/pkl/Evidence.pkl` and
copy `evidence_Evidence_pkl.py` into `lib/` (binding version 0.1.19).
