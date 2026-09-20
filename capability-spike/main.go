// Command capability-spike is CIT-139's reproducible demo: a worker
// fact starts red, the supervisor approves it via governed state (never
// by editing the fact), the same fact turns green, a Proton Pass
// operation is recorded against the fact's stable ID, and a
// reconciliation check proves fact <-> approval <-> Proton reason agree
// -- then flags a deliberately misaligned second pass.
package main

import (
	"context"
	"fmt"
	"os"
)

func main() {
	ctx := context.Background()
	transcript, aligned, misaligned, err := runDemo(ctx)
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
	fmt.Println()
	fmt.Println("demo: OK")
}
