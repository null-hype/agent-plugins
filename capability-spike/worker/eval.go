// Package worker drives evaluation of worker-owned pkl:test fact files.
//
// It never writes to pkl/Ledger.pkl or pkl/GrantState.pkl -- those are
// supervisor-owned (see supervisor/state.go). A worker fact proves a
// capability only by asking Ledger.checkAccess a question it does not
// control the answer to.
package worker

import (
	"context"
	"os/exec"
)

// pklCommand mirrors this repo's convention (see hk.pkl's check steps) of
// invoking Pkl through `mise exec -- pkl` so the mise.toml-pinned version
// is used when mise is available, falling back to a bare `pkl` on the
// PATH otherwise (e.g. this spike run standalone, outside the repo's
// devcontainer).
func pklCommand(ctx context.Context, args ...string) *exec.Cmd {
	if _, err := exec.LookPath("mise"); err == nil {
		return exec.CommandContext(ctx, "mise", append([]string{"exec", "--", "pkl"}, args...)...)
	}
	return exec.CommandContext(ctx, "pkl", args...)
}

// Result is the outcome of running `pkl test` against one worker fact
// file. pkl:test's facts{} block cannot itself catch a thrown Pkl error
// (see pkl/Ledger.pkl's doc comment and CIT-96's
// check-taint-trace-fail-closed.sh precedent), so rejection surfaces as a
// non-zero exit and stderr, not as a value Pkl code can branch on -- this
// is why this runs `pkl test` as a subprocess rather than evaluating an
// expression in-process.
type Result struct {
	FactPath string
	Passed   bool
	Stderr   string
}

// Run evaluates factPath with `pkl test` and reports whether every fact
// in it passed.
func Run(ctx context.Context, factPath string) (Result, error) {
	cmd := pklCommand(ctx, "test", factPath)
	out, err := cmd.CombinedOutput()
	res := Result{FactPath: factPath, Stderr: string(out)}
	if err == nil {
		res.Passed = true
		return res, nil
	}
	if _, isExit := err.(*exec.ExitError); isExit {
		res.Passed = false
		return res, nil
	}
	return res, err
}
