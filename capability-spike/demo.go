package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"dagger/capability-spike/diagnostic"
	"dagger/capability-spike/reconcile"
	"dagger/capability-spike/runtime"
	"dagger/capability-spike/supervisor"
	"dagger/capability-spike/worker"
)

const (
	statePath        = "pkl/GrantState.pkl"
	protonLedgerPath = "build/proton-observed.jsonl"

	mainFactPath = "worker/flight_booking_area51.pkl"
	mainFactID   = "flight-booking:area51:vault-access"
	mainVault    = "thepentagon.com"

	rejectedFactPath = "worker/fixtures_invalid/explicitly_rejected.pkl"
	rejectedFactID   = "area51:site4:black-budget-vault-access"
	rejectedVault    = "site4.internal"

	neverApprovedFactPath = "worker/fixtures_invalid/never_approved.pkl"
	neverApprovedFactID   = "shadow-request:roswell:vault-access"

	mismatchFactPath = "worker/fixtures_invalid/vault_mismatch.pkl"

	bypassFactPath = "worker/fixtures_invalid/bypassed_gate.pkl"
)

// runDemo executes CIT-139's full red -> approve -> green ->
// materialize -> reconcile loop and returns a human-readable transcript
// plus the flags a *separate*, deliberately-misaligned reconciliation
// pass surfaces. It resets pkl/GrantState.pkl to empty first so the run
// is reproducible regardless of prior state on disk.
func runDemo(ctx context.Context) (transcript string, transitions []Transition, alignedFlags, misalignedFlags []reconcile.Flag, err error) {
	var t strings.Builder
	step := func(format string, args ...any) { fmt.Fprintf(&t, format+"\n", args...) }
	record := func(tr Transition) { tr.Index = len(transitions) + 1; transitions = append(transitions, tr) }

	if err = resetState(); err != nil {
		return "", nil, nil, nil, err
	}
	if err = os.MkdirAll("build", 0o755); err != nil {
		return "", nil, nil, nil, err
	}
	if err = os.Remove(protonLedgerPath); err != nil && !os.IsNotExist(err) {
		return "", nil, nil, nil, err
	}

	beforeHash, err := reconcile.Sha256Hex(mainFactPath)
	if err != nil {
		return "", nil, nil, nil, err
	}

	step("=== 1. Worker fact starts red ===")
	step("worker fact: %s (fact_id=%s)", mainFactPath, mainFactID)
	red, err := worker.Run(ctx, mainFactPath)
	if err != nil {
		return "", nil, nil, nil, err
	}
	if red.Passed {
		return "", nil, nil, nil, fmt.Errorf("expected worker fact to start red, but it passed")
	}
	diag, ok := diagnostic.Parse(red.Stderr)
	if !ok {
		return "", nil, nil, nil, fmt.Errorf("expected a parseable diagnostic, got:\n%s", red.Stderr)
	}
	step("red: pkl test failed as expected")
	step("diagnostic: severity=%s code=%s factID=%s vault=%s message=%q",
		diag.Severity, diag.Code, diag.FactID, diag.Vault, diag.Message)
	record(Transition{
		Kind: "evaluation", Label: "Worker fact starts red",
		FactID: strPtr(mainFactID), Vault: strPtr(mainVault),
		GoverningRule: strPtr(diag.Message), Fact: factFromDiagnostic(diag),
	})

	step("")
	step("=== 2. Worker cannot self-grant; asserts unchanged ===")
	step("(the worker never edits pkl/Ledger.pkl or pkl/GrantState.pkl)")

	step("")
	step("=== 3. Supervisor decides: approve main request, explicitly reject a second ===")
	mainGrant := supervisor.Grant{FactID: mainFactID, Vault: mainVault, Approved: true}
	rejectedGrant := supervisor.Grant{FactID: rejectedFactID, Vault: rejectedVault, Approved: false}
	if err = supervisor.Decide(ctx, statePath, mainGrant, rejectedGrant); err != nil {
		return "", nil, nil, nil, err
	}
	step("supervisor wrote %s: approved %s for vault %s; rejected %s", statePath, mainFactID, mainVault, rejectedFactID)
	record(Transition{
		Kind: "policy-decision", Label: "Supervisor approves the main request",
		FactID: strPtr(mainFactID), Vault: strPtr(mainVault), Grant: grantOf(mainGrant),
	})
	record(Transition{
		Kind: "policy-decision", Label: "Supervisor explicitly rejects a second request",
		FactID: strPtr(rejectedFactID), Vault: strPtr(rejectedVault), Grant: grantOf(rejectedGrant),
	})

	step("")
	step("=== 4. Same, unmodified worker fact now evaluates green ===")
	green, err := worker.Run(ctx, mainFactPath)
	if err != nil {
		return "", nil, nil, nil, err
	}
	if !green.Passed {
		return "", nil, nil, nil, fmt.Errorf("expected worker fact to pass after approval, got:\n%s", green.Stderr)
	}
	afterHash, err := reconcile.Sha256Hex(mainFactPath)
	if err != nil {
		return "", nil, nil, nil, err
	}
	if beforeHash != afterHash {
		return "", nil, nil, nil, fmt.Errorf("worker fact file changed between red and green (%s -> %s); approval must not require editing the fact", beforeHash, afterHash)
	}
	step("green: pkl test passed")
	step("worker fact sha256 unchanged: %s", afterHash)
	record(Transition{
		Kind: "evaluation", Label: "Same, unmodified worker fact now evaluates green",
		FactID: strPtr(mainFactID), Vault: strPtr(mainVault),
	})

	step("")
	step("=== 5. Approved but not yet materialized: flagged as missing ===")
	preMaterialization, err := reconcile.Check(ctx, statePath, protonLedgerPath, nil)
	if err != nil {
		return "", nil, nil, nil, err
	}
	if len(preMaterialization) != 1 || preMaterialization[0].Kind != reconcile.FlagMissingMaterialization || preMaterialization[0].FactID != mainFactID {
		return "", nil, nil, nil, fmt.Errorf("expected exactly one missing-materialization flag for %s before recording the Proton observation, got: %+v", mainFactID, preMaterialization)
	}
	step("flagged (expected): %s fact=%s: %s", preMaterialization[0].Kind, preMaterialization[0].FactID, preMaterialization[0].Detail)
	record(Transition{
		Kind: "reconciliation", Label: "Approved but not yet materialized: flagged as missing",
		FactID: strPtr(mainFactID), Vault: strPtr(mainVault),
		GoverningRule: strPtr(preMaterialization[0].Detail), Flag: flagOf(preMaterialization[0]),
	})

	step("")
	step("=== 6. Rejected fact stays red with a useful diagnostic ===")
	stillRed, err := worker.Run(ctx, rejectedFactPath)
	if err != nil {
		return "", nil, nil, nil, err
	}
	if stillRed.Passed {
		return "", nil, nil, nil, fmt.Errorf("expected explicitly-rejected fact to stay red")
	}
	rejectDiag, _ := diagnostic.Parse(stillRed.Stderr)
	step("diagnostic: code=%s message=%q", rejectDiag.Code, rejectDiag.Message)
	record(Transition{
		Kind: "evaluation", Label: "Rejected fact stays red with a useful diagnostic",
		FactID: strPtr(rejectedFactID), Vault: strPtr(rejectedVault),
		GoverningRule: strPtr(rejectDiag.Message), Fact: factFromDiagnostic(rejectDiag),
	})

	step("")
	step("=== 7. Proton Pass operation recorded, keyed by the stable fact ID ===")
	if err = runtime.RecordMaterialization(protonLedgerPath, runtime.Observation{
		FactID:    mainFactID,
		Vault:     mainVault,
		Reason:    mainFactID, // PROTON_PASS_AGENT_REASON=<fact_id>
		Operation: "pass-cli item view --vault-name thepentagon.com --item-title vault-access",
	}); err != nil {
		return "", nil, nil, nil, err
	}
	step("PROTON_PASS_AGENT_REASON=%s recorded to %s", mainFactID, protonLedgerPath)
	recordedObs, err := runtime.LoadObservations(protonLedgerPath)
	if err != nil {
		return "", nil, nil, nil, err
	}
	record(Transition{
		Kind: "materialization", Label: "Proton Pass operation recorded, keyed by the stable fact ID",
		FactID: strPtr(mainFactID), Vault: strPtr(mainVault),
		Observation: observationOf(recordedObs[len(recordedObs)-1]),
	})

	step("")
	step("=== 8. Reconciliation: fact <-> approval <-> Proton reason ===")
	alignedFlags, err = reconcile.Check(ctx, statePath, protonLedgerPath, []reconcile.FactFile{
		{FactID: mainFactID, Path: mainFactPath},
	})
	if err != nil {
		return "", nil, nil, nil, err
	}
	if len(alignedFlags) == 0 {
		step("reconciliation: aligned, no flags")
	} else {
		for _, f := range alignedFlags {
			step("UNEXPECTED FLAG: %s fact=%s: %s", f.Kind, f.FactID, f.Detail)
		}
	}
	record(Transition{
		Kind: "reconciliation", Label: "Reconciliation: fact <-> approval <-> Proton reason",
		FactID: strPtr(mainFactID), Vault: strPtr(mainVault),
	})

	step("")
	step("=== 9. Deliberately misaligned pass: every negative fixture flagged ===")
	// An observation with no approved grant at all.
	if err = runtime.RecordMaterialization(protonLedgerPath, runtime.Observation{
		FactID: neverApprovedFactID,
		Vault:  "area51.internal",
		Reason: neverApprovedFactID,
	}); err != nil {
		return "", nil, nil, nil, err
	}
	// An observation filed under the approved factID, but whose
	// PROTON_PASS_AGENT_REASON names a different fact entirely -- the
	// reason doesn't correspond to the governing fact.
	if err = runtime.RecordMaterialization(protonLedgerPath, runtime.Observation{
		FactID: mainFactID,
		Vault:  mainVault,
		Reason: rejectedFactID,
	}); err != nil {
		return "", nil, nil, nil, err
	}
	// An observation for the approved factID with the right reason but
	// naming a different vault than the grant covers.
	if err = runtime.RecordMaterialization(protonLedgerPath, runtime.Observation{
		FactID: mainFactID,
		Vault:  "cia.gov",
		Reason: mainFactID,
	}); err != nil {
		return "", nil, nil, nil, err
	}
	misalignedFlags, err = reconcile.Check(ctx, statePath, protonLedgerPath, []reconcile.FactFile{
		{FactID: mainFactID, Path: mainFactPath},   // legitimately green
		{FactID: mainFactID, Path: bypassFactPath}, // green but bypasses the gate
		{FactID: neverApprovedFactID, Path: neverApprovedFactPath},
	})
	if err != nil {
		return "", nil, nil, nil, err
	}
	for _, f := range misalignedFlags {
		step("flagged: %s fact=%s: %s", f.Kind, f.FactID, f.Detail)
		record(Transition{
			Kind: "reconciliation", Label: "Deliberately misaligned pass: flag detected",
			FactID: strPtr(f.FactID), GoverningRule: strPtr(f.Detail), Flag: flagOf(f),
		})
	}
	_ = mismatchFactPath // exercised directly in tests, not the transcript

	return t.String(), transitions, alignedFlags, misalignedFlags, nil
}

func resetState() error {
	return supervisor.ResetState(statePath)
}
