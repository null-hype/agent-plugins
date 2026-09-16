// Package supervisor owns pkl/GrantState.pkl: the only Pkl module a
// grant/reject decision may change. It is the sole writer of that file
// in this demo -- the worker package never touches it, and no code path
// here ever edits a worker-owned fact file under worker/.
package supervisor

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/apple/pkl-go/pkl"
)

// Grant mirrors pkl/GrantState.pkl's `Grant` class. Loaded through the
// real pkl-go bindings (pkl.NewEvaluator + EvaluateModule), not by
// parsing GrantState.pkl's text -- this is CIT-139's "loads a
// supervisor-owned Pkl module via the Go bindings" leg.
type Grant struct {
	FactID   string `pkl:"factID"`
	Vault    string `pkl:"vault"`
	Approved bool   `pkl:"approved"`
}

// GrantState mirrors pkl/GrantState.pkl's module-level `approvedGrants`.
type GrantState struct {
	ApprovedGrants map[string]*Grant `pkl:"approvedGrants"`
}

// LoadState evaluates statePath (normally pkl/GrantState.pkl) through a
// pkl-go Evaluator into a GrantState.
func LoadState(ctx context.Context, statePath string) (GrantState, error) {
	evaluator, err := pkl.NewEvaluator(ctx, pkl.PreconfiguredOptions)
	if err != nil {
		return GrantState{}, fmt.Errorf("start pkl evaluator: %w", err)
	}
	defer evaluator.Close()

	var state GrantState
	if err := evaluator.EvaluateModule(ctx, pkl.FileSource(statePath), &state); err != nil {
		return GrantState{}, fmt.Errorf("evaluate %s: %w", statePath, err)
	}
	return state, nil
}

// Decide is the only function in this demo that changes governed state.
// It re-renders statePath from scratch with grants merged in -- the
// supervisor's decision is the entire content of the file, not a patch
// applied to the worker's fact.
func Decide(ctx context.Context, statePath string, grants ...Grant) error {
	var current GrantState
	if _, statErr := os.Stat(statePath); os.IsNotExist(statErr) {
		// A missing file is a legitimate fresh start.
		current = GrantState{ApprovedGrants: map[string]*Grant{}}
	} else {
		// A file that exists but fails to evaluate is a corrupt ledger,
		// not an empty one -- silently replacing it here would be the
		// same fail-open bug CIT-96's Scope.pkl was fixed for (see
		// 18edd6b). Surface it instead of wiping every existing grant.
		var err error
		current, err = LoadState(ctx, statePath)
		if err != nil {
			return fmt.Errorf("load existing state before deciding: %w", err)
		}
	}
	if current.ApprovedGrants == nil {
		current.ApprovedGrants = map[string]*Grant{}
	}
	for i := range grants {
		g := grants[i]
		current.ApprovedGrants[g.FactID] = &g
	}
	return render(statePath, current)
}

// ResetState writes an empty GrantState.pkl to statePath, so a demo run
// or test does not depend on decisions a prior run left on disk.
func ResetState(statePath string) error {
	return render(statePath, GrantState{ApprovedGrants: map[string]*Grant{}})
}

func render(statePath string, state GrantState) error {
	ids := make([]string, 0, len(state.ApprovedGrants))
	for id := range state.ApprovedGrants {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var b strings.Builder
	b.WriteString("/// Supervisor-owned approval ledger. Rendered by supervisor/state.go --\n")
	b.WriteString("/// do not hand-edit; do not let worker code write this file.\n")
	b.WriteString("module grantState\n\n")
	b.WriteString("class Grant {\n  factID: String\n  vault: String\n  approved: Boolean\n}\n\n")
	b.WriteString("approvedGrants: Mapping<String, Grant> = new {\n")
	for _, id := range ids {
		g := state.ApprovedGrants[id]
		fmt.Fprintf(&b, "  [%q] { factID = %q; vault = %q; approved = %v }\n",
			g.FactID, g.FactID, g.Vault, g.Approved)
	}
	b.WriteString("}\n")

	return os.WriteFile(statePath, []byte(b.String()), 0o644)
}
