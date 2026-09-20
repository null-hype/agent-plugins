// Command capability-spike is CIT-139's reproducible demo: a worker
// fact starts red, the supervisor approves it via governed state (never
// by editing the fact), the same fact turns green, a Proton Pass
// operation is recorded against the fact's stable ID, and a
// reconciliation check proves fact <-> approval <-> Proton reason agree
// -- then flags a deliberately misaligned second pass.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func main() {
	traceOut := flag.String("trace-out", "", "optional path to write this run's CapabilityTrace as JSON (see Evidence.pkl's CapabilityTrace class)")
	flag.Parse()

	ctx := context.Background()
	transcript, transitions, aligned, misaligned, err := runDemo(ctx)
	fmt.Print(transcript)
	if err != nil {
		fmt.Fprintln(os.Stderr, "FAILED:", err)
		os.Exit(1)
	}
	if len(aligned) != 0 {
		fmt.Fprintln(os.Stderr, "FAILED: expected the main pass to be aligned with zero flags")
		os.Exit(1)
	}
	if len(misaligned) < 4 {
		fmt.Fprintln(os.Stderr, "FAILED: expected the deliberately-misaligned pass to surface at least 4 flags")
		os.Exit(1)
	}

	if *traceOut != "" {
		if err := writeTrace(*traceOut, transitions); err != nil {
			fmt.Fprintln(os.Stderr, "FAILED: writing -trace-out:", err)
			os.Exit(1)
		}
	}

	fmt.Println()
	fmt.Println("demo: OK")
}

// writeTrace emits this run's transitions as a CapabilityTrace JSON file --
// the real-execution adapter CIT-147 slice 2's TK lesson consumes. sourceRef
// is this checkout's actual commit SHA (falling back to a fixed placeholder
// outside a git checkout, e.g. a container image with no .git), never a
// fabricated value.
func writeTrace(path string, transitions []Transition) error {
	sourceRef := "unknown (not a git checkout)"
	if out, err := exec.Command("git", "rev-parse", "HEAD").Output(); err == nil {
		sourceRef = strings.TrimSpace(string(out))
	}
	approvalCheck, err := loadApprovalCheck(sourceRef)
	if err != nil {
		return fmt.Errorf("loading approval check axiom: %w", err)
	}
	trace := CapabilityTrace{
		TraceID:     "capability-spike-demo",
		Scenario:    "capability-spike red-approve-green-materialize-reconcile",
		Source:      "capability-spike-demo",
		SourceRef:   sourceRef,
		Checks:      []Check{approvalCheck},
		Transitions: transitions,
	}
	data, err := json.MarshalIndent(trace, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// ledgerPklPath is pkl/Ledger.pkl's path relative to this module's root --
// the same axiom worker.Run's `pkl test` subprocess actually evaluates.
const ledgerPklPath = "pkl/Ledger.pkl"

// checkAccessMarker is where pkl/Ledger.pkl's checkAccess() function
// starts; it is the last declaration in that file, so everything from the
// marker to EOF is the function's verbatim source. If a future edit to
// Ledger.pkl appends something after checkAccess, this marker still finds
// the right start but would over-capture -- extraction failing loudly (see
// below) rather than silently is preferred over guessing a smarter end
// boundary for a spike-sized file.
const checkAccessMarker = "function checkAccess"

// loadApprovalCheck reads pkl/Ledger.pkl from disk and lifts checkAccess's
// real source text verbatim -- never re-authored prose -- as the axiom
// this trace's transitions are evidence for or against. requirement is the
// one hand-written sentence restating what constraint's logic does.
func loadApprovalCheck(sourceRef string) (Check, error) {
	data, err := os.ReadFile(ledgerPklPath)
	if err != nil {
		return Check{}, err
	}
	idx := strings.Index(string(data), checkAccessMarker)
	if idx == -1 {
		return Check{}, fmt.Errorf("%s: marker %q not found -- checkAccess() axiom extraction is stale", ledgerPklPath, checkAccessMarker)
	}
	constraint := strings.TrimRight(string(data)[idx:], "\n")
	return Check{
		ID:          "ledger.checkAccess",
		Requirement: "A worker fact's capability request is granted only if the supervisor has recorded an approved grant for exactly this (factID, vault) pair.",
		Constraint:  constraint,
		Source:      "capability-spike/" + ledgerPklPath,
		SourceRef:   sourceRef,
	}, nil
}
