// Package reconcile checks that requested facts, supervisor-approved
// grants, and observed Proton Pass reasons agree -- CIT-139's alignment
// invariant:
//
//	Pkl fact requesting capability
//	        ↕
//	supervisor-approved state change
//	        ↕
//	PROTON_PASS_AGENT_REASON / stable fact ID
//	        ↕
//	observed materialized capability acquisition
package reconcile

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"dagger/capability-spike/runtime"
	"dagger/capability-spike/supervisor"
)

type FlagKind string

const (
	// FlagUnapprovedMaterialization: an Observation exists with no
	// matching approved grant.
	FlagUnapprovedMaterialization FlagKind = "unapproved-materialization"
	// FlagMissingMaterialization: a grant is approved but no Observation
	// was ever recorded for it.
	FlagMissingMaterialization FlagKind = "missing-materialization"
	// FlagReasonMismatch: an Observation's factID/vault does not match
	// the governing grant it claims to be for.
	FlagReasonMismatch FlagKind = "reason-mismatch"
	// FlagBoundaryBypassed: the worker fact file governing a green result
	// does not call Ledger.checkAccess at all -- it cannot have gone
	// through the supervisor gate no matter what GrantState.pkl says.
	FlagBoundaryBypassed FlagKind = "boundary-bypassed"
)

type Flag struct {
	Kind   FlagKind `json:"kind"`
	FactID string   `json:"factID"`
	Detail string   `json:"detail"`
}

// FactFile is one worker-owned fact to check for boundary bypass, keyed
// by the stable fact ID it asserts (must match the factID embedded in
// its own `local factID = "..."` line and the one the demo expects it to
// prove).
type FactFile struct {
	FactID string
	Path   string
}

// Check reconciles supervisor state (loaded live via the pkl-go bindings,
// not by re-reading Go-side copies), the Proton observation ledger, and
// the worker fact files that are supposed to be green. It never trusts
// `pkl test`'s pass/fail alone -- a fact can pass `pkl test` and still be
// flagged here (FlagBoundaryBypassed).
func Check(ctx context.Context, statePath, protonLedgerPath string, facts []FactFile) ([]Flag, error) {
	var flags []Flag

	state, err := supervisor.LoadState(ctx, statePath)
	if err != nil {
		return nil, err
	}
	observations, err := runtime.LoadObservations(protonLedgerPath)
	if err != nil {
		return nil, err
	}

	obsByFact := map[string]runtime.Observation{}
	for _, o := range observations {
		obsByFact[o.FactID] = o
		grant, approved := state.ApprovedGrants[o.FactID]
		if !approved || grant == nil || !grant.Approved {
			flags = append(flags, Flag{
				Kind:   FlagUnapprovedMaterialization,
				FactID: o.FactID,
				Detail: "Proton observation recorded with no matching approved grant",
			})
			continue
		}
		// Reason is the field PROTON_PASS_AGENT_REASON actually carried at
		// materialization time -- the one that can drift in a real
		// integration. FactID is metadata the recorder chose, so checking
		// it alone would validate nothing; the reason itself must equal
		// the stable fact ID it's filed under.
		if o.Reason != o.FactID {
			flags = append(flags, Flag{
				Kind:   FlagReasonMismatch,
				FactID: o.FactID,
				Detail: fmt.Sprintf("PROTON_PASS_AGENT_REASON %q does not match the governing fact ID %q", o.Reason, o.FactID),
			})
		}
		if o.Vault != grant.Vault {
			flags = append(flags, Flag{
				Kind:   FlagReasonMismatch,
				FactID: o.FactID,
				Detail: fmt.Sprintf("observed vault %q does not match the governing grant's vault %q", o.Vault, grant.Vault),
			})
		}
	}

	for factID, grant := range state.ApprovedGrants {
		if !grant.Approved {
			continue
		}
		if _, seen := obsByFact[factID]; !seen {
			flags = append(flags, Flag{
				Kind:   FlagMissingMaterialization,
				FactID: factID,
				Detail: "grant approved but no Proton materialization was ever observed",
			})
		}
	}

	for _, f := range facts {
		routed, err := factRoutesThroughGate(f.Path)
		if err != nil {
			return nil, err
		}
		if !routed {
			flags = append(flags, Flag{
				Kind:   FlagBoundaryBypassed,
				FactID: f.FactID,
				Detail: f.Path + " does not call Ledger.checkAccess -- any green result did not go through the supervisor boundary",
			})
		}
	}

	return flags, nil
}

// factRoutesThroughGate is a structural check, not a semantic one: it
// confirms the fact file's own text calls the supervisor gate. `pkl
// test`'s exit code alone cannot distinguish a fact that passed because
// the supervisor approved it from one a worker hardcoded to `true` --
// both just report success.
func factRoutesThroughGate(path string) (bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	return strings.Contains(string(data), "Ledger.checkAccess("), nil
}

// Sha256Hex returns the hex sha256 of path's contents, for pinning a
// worker fact file's identity across a red->green transition (see
// main.go: the demo asserts this hash is unchanged after approval).
func Sha256Hex(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}
