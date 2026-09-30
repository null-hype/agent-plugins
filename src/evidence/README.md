# Evidence contract (`evidence`)

The contract between the reasoning agent and everything downstream (Jev client, scoring). Contains no case data.

**Pkl is authoritative for structure.** `pkl/Evidence.pkl` defines the evidence record: `{"findings": [...]}`, each finding a `component`, `source_path` (relative to the image root), `excerpt`, the `never` it implies and `enforced`. Classes are closed; `{"findings": []}` ("no findings") is valid. `pkl/Scenario.pkl` is the contract for a method scenario (canned observations, fixed Jev questions, pre-registered expectations, invariants for `pkl test`). Python is only the execution/filesystem adapter.

```bash
evidence-validate evidence.json                        # format (evaluated by Pkl)
evidence-validate --root /path/to/image evidence.json  # format + grounding
```

Grounding: each `excerpt` must appear verbatim in the file at `source_path` under `--root`; paths that escape the root (including via symlinks) fail. Exit 0 = ok, 1 = invalid/ungrounded (problems on stderr), 2 = usage.

## Installed

| Path | What |
|---|---|
| `pkl` | pinned Pkl runtime (option `pklVersion`; default is checksum-pinned) |
| `/usr/local/share/evidence/pkl/` | `Evidence.pkl`, `Validate.pkl`, `Scenario.pkl` (use `--module-path`, import as `modulepath:/Scenario.pkl`) |
| `/usr/local/share/evidence/lib/` | `evidence_contract.py` (adapter), `contract_suite.py` (scenario driver) |
| `evidence-validate` | format + grounding CLI |

## Running a Pkl-defined scenario

A scenario `amends "modulepath:/Scenario.pkl"`; a thin `<scenario>_test.py` calls `contract_suite.main(<module>)`. The adapter loads the evaluated Pkl, validates and grounds the evidence, **transforms the validated evidence into the state sent to Jev** (`evidence_to_state`), calls the installed `jev`, and asserts. Malformed or ungrounded evidence is rejected before `jev` is invoked. Expectations are evaluator-only: never in the agent's context or Jev's request; question templates are fixed.

## Execution modes and spend

| Mode | Evidence | Jev | Needs |
|---|---|---|---|
| `deterministic` (default; ordinary CI) | canned | mock | nothing |
| `live-jev` | canned | real | `CONTRACT_ALLOW_REAL_JEV=1` + a Jev credential |
| `full-experiment` | agent-collected | real | both `CONTRACT_ALLOW_REAL_JEV=1` and `CONTRACT_ALLOW_REASONING_AGENT=1`, a Jev credential, `REASONING_AGENT_RUNNER` |

Select with `CONTRACT_MODE` / `--mode`. **Credentials never select a mode**; the opt-in switches default off even when credentials exist. Deterministic mode refuses any real call and never falls back from mock to real. A disabled live mode prints `NOT RUN`, separate from deterministic results; an explicitly requested mode whose prerequisite is missing is `BLOCKED` (exit 1). Bounds: `CONTRACT_REPEATS` (1..5) is enforced; `CONTRACT_MAX_TOKENS`/`CONTRACT_MAX_USD` are refused because neither the `jev` client nor a reasoning-agent runner can enforce them (fail closed). Mock assertions establish wiring, not Jev's discrimination or calibration.

## Expectations, verdicts and records

**Pkl owns the semantics.** `pkl/Verdicts.pkl` defines the comparison functions and `Scenario.evaluate` applies a scenario's registered expectations to an observed world (Jev probabilities keyed by declared case identity), returning typed verdicts: `EXPECTED_ORDER` / `ORDER_REVERSED` / `ORDER_TIED`, `WITHIN_BAND` / `OUTSIDE_BAND`, `VALID_PROBABILITY` / `INVALID_PROBABILITY`, `MISSING_OBSERVATION`, `NOT_ASSERTED_UNCALIBRATED`. Python only supplies the world (`-p world.uri=`) and runs a thin matcher, the `expect(fact).toHaveVerdict(axiom, world, code)` shape used in `tutorial-app`: it compares the actual code with the registered one (`expected`; `accepted` lists the codes that pass) and records the evaluation.

- **Required checks fail on a missing observation** (`required = true`, the default). Agent-collected evidence is scored as the scenario's declared `agentObservationId`, not a generic id.
- **Calibration is explicit.** An uncalibrated band (`calibrated = false`, the default) is a mock wiring check; on a real result it yields the recorded status `not-asserted`, reported separately and never counted as verified.
- **Every repeat is its own world**, evaluated independently (no aggregation rule is registered).
- **Known inputs:** a scenario's `diagnostics` (aligned, out-of-band, reversed, tied, invalid, missing, uncalibrated) are checked by `pkl test` facts and a golden `-expected.pcf`, and re-asserted through the matcher; an expected diagnostic passes.
- **Records:** every evaluation, pass or fail, is appended to `evaluations.jsonl` (run, repeat, caseId, checkId, axiom, worldRef, actual, expected, accepted, status, message). `worldRef` names a preserved `worlds/repeat-N/` directory holding the evidence, the state sent to Jev, the results and `world.json`. Records go to `CONTRACT_RECORDS_DIR` (default `/tmp/contract-records`) and CI uploads them as artifacts even on failure.

## Agent isolation (prerequisite for `full-experiment`)

The adapter runs the runner with an allowlisted environment (`PATH`, `HOME`, `LANG`, ... plus names in `REASONING_AGENT_ENV_ALLOW`), `cwd` = the root, and requires it to write an isolation manifest (`--isolation-manifest FILE`: `tools`, `disallowed`, `fs_roots`). Evidence is returned only if the manifest lists no web or shell tools and `fs_roots` is exactly the root; otherwise collection fails closed. This verifies the runner's **declared** contract. It does not prove containment: the runner must itself prevent reads outside its roots, and that needs recorded evidence (CIT-271/CIT-288) before isolation is claimed. The deterministic suite's fake runner tests the adapter, not any runner.

## Other paid paths

The `pass-cli` feature's `color` bin (and the legacy `jin-81/90/91`, `restic-backup` scenarios) make Claude calls only with `PASS_CLI_ALLOW_CLAUDE=1` (default off; `color resume` exits 3 without it). A live `pass-cli` session alone never enables a paid call.
