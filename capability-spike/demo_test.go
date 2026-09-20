package main

import (
	"context"
	"strings"
	"testing"

	"dagger/capability-spike/diagnostic"
	"dagger/capability-spike/supervisor"
	"dagger/capability-spike/worker"
)

func TestDemoRedApproveGreenReconcile(t *testing.T) {
	transcript, aligned, misaligned, err := runDemo(context.Background())
	if err != nil {
		t.Fatalf("runDemo: %v\ntranscript so far:\n%s", err, transcript)
	}
	if len(aligned) != 0 {
		t.Errorf("expected the initial reconciliation pass to be aligned, got flags: %+v", aligned)
	}
	if len(misaligned) < 4 {
		t.Errorf("expected the deliberately misaligned pass to surface at least 4 flags, got %d: %+v", len(misaligned), misaligned)
	}
	if !strings.Contains(transcript, "CAP_NO_GRANT") {
		t.Error("expected transcript to show the initial CAP_NO_GRANT rejection diagnostic")
	}
	if !strings.Contains(transcript, "CAP_REJECTED") {
		t.Error("expected transcript to show the explicit-rejection diagnostic")
	}
}

// TestVaultMismatchRejected covers CIT-139's requirement that an approved
// grant does not transitively authorize a different vault under the same
// fact ID: vault_mismatch.pkl shares flight_booking_area51.pkl's factID
// but requests a different vault, so it must fail even once that factID
// is approved.
func TestVaultMismatchRejected(t *testing.T) {
	ctx := context.Background()
	if err := resetState(); err != nil {
		t.Fatalf("resetState: %v", err)
	}

	// Before any decision: CAP_NO_GRANT, not CAP_VAULT_MISMATCH.
	before, err := worker.Run(ctx, mismatchFactPath)
	if err != nil {
		t.Fatalf("worker.Run: %v", err)
	}
	if before.Passed {
		t.Fatal("expected vault_mismatch.pkl to fail with no grant recorded at all")
	}
	beforeDiag, ok := diagnostic.Parse(before.Stderr)
	if !ok || beforeDiag.Code != "CAP_NO_GRANT" {
		t.Fatalf("expected CAP_NO_GRANT before any decision, got %+v (ok=%v)", beforeDiag, ok)
	}

	// Approve the fact's ID for its real vault (mainVault) -- the
	// mismatched fixture requests a different vault under the same ID.
	if err := supervisor.Decide(ctx, statePath, supervisor.Grant{FactID: mainFactID, Vault: mainVault, Approved: true}); err != nil {
		t.Fatalf("supervisor.Decide: %v", err)
	}

	after, err := worker.Run(ctx, mismatchFactPath)
	if err != nil {
		t.Fatalf("worker.Run: %v", err)
	}
	if after.Passed {
		t.Fatal("expected vault_mismatch.pkl to still fail once the factID is approved for a different vault")
	}
	afterDiag, ok := diagnostic.Parse(after.Stderr)
	if !ok || afterDiag.Code != "CAP_VAULT_MISMATCH" {
		t.Fatalf("expected CAP_VAULT_MISMATCH once approved for a different vault, got %+v (ok=%v)", afterDiag, ok)
	}
}

func TestNeverApprovedFactAlwaysRed(t *testing.T) {
	ctx := context.Background()
	if err := resetState(); err != nil {
		t.Fatalf("resetState: %v", err)
	}
	res, err := worker.Run(ctx, neverApprovedFactPath)
	if err != nil {
		t.Fatalf("worker.Run: %v", err)
	}
	if res.Passed {
		t.Fatal("never_approved.pkl must never pass without a supervisor grant")
	}
}

func TestBypassedGatePassesPklTestButFlaggedByReconciliation(t *testing.T) {
	ctx := context.Background()
	res, err := worker.Run(ctx, bypassFactPath)
	if err != nil {
		t.Fatalf("worker.Run: %v", err)
	}
	if !res.Passed {
		t.Fatal("bypassed_gate.pkl is expected to pass `pkl test` on its own -- that's exactly why reconciliation, not pkl test, must catch it")
	}
}
