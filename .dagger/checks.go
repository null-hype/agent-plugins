package main

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"dagger/agent-plugins/internal/dagger"
)

func assertContains(haystack, needle string) error {
	if !strings.Contains(haystack, needle) {
		return fmt.Errorf("expected output to contain %q, got %q", needle, haystack)
	}
	return nil
}

var semverRe = regexp.MustCompile(`v?\d+\.\d+\.\d+`)

func assertVersionLike(out string) error {
	if !semverRe.MatchString(out) {
		return fmt.Errorf("expected output to contain a version number, got %q", out)
	}
	return nil
}

// toolCheck is one "run this binary, expect this substring in its output"
// assertion, reusable across the table-driven per-artifact checks below.
type toolCheck struct {
	bin, arg, want string
}

// runToolChecks runs each check against image in turn, stopping at the
// first failure.
func runToolChecks(ctx context.Context, image *dagger.Container, checks []toolCheck) error {
	for _, tc := range checks {
		out, err := image.WithExec([]string{tc.bin, tc.arg}).Stdout(ctx)
		if err != nil {
			return fmt.Errorf("%s: %w", tc.bin, err)
		}
		if err := assertContains(out, tc.want); err != nil {
			return fmt.Errorf("%s: %w", tc.bin, err)
		}
	}
	return nil
}

// runToolChecksAsUser is runToolChecks under a non-root user. Several
// installers (container-use, claude) drop their binary under /root, which is
// 700 -- running a check as root would silently miss that the binary is
// unreachable for anyone else.
func runToolChecksAsUser(ctx context.Context, image *dagger.Container, user string, checks []toolCheck) error {
	return runToolChecks(ctx, image.WithUser(user), checks)
}
