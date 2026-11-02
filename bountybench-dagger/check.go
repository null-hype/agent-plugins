package main

import (
	"context"
	"fmt"
	"strings"
)

// SemanticDrift preserves the executed Gunicorn witness behind INF-5 as a
// Dagger check. The historical WriteSkew call remains available for inspecting
// the full matrix; this check asserts the specific semantic-drift shape that
// matrix established, including the caveat that branch B is already unsafe
// under the broader plain-chunked control.
//
// +check
func (m *BountybenchDagger) SemanticDrift(ctx context.Context) error {
	matrix, err := m.WriteSkew(ctx)
	if err != nil {
		return err
	}

	// These are the four semantic observations the witness represents. Keeping
	// both payload columns prevents this check from quietly turning the result
	// back into the stronger (and false) "two safe branches" write-skew claim.
	expected := []string{
		"base (secure)          control=ok  direct/admin=403  |  chunked,gzip=blocked  |  plain-chunked+CL=blocked",
		"base+A                 control=ok  direct/admin=403  |  chunked,gzip=blocked  |  plain-chunked+CL=blocked",
		"base+B                 control=ok  direct/admin=403  |  chunked,gzip=blocked  |  plain-chunked+CL=REACHED",
		"base+A+B (git merge)   control=ok  direct/admin=403  |  chunked,gzip=REACHED  |  plain-chunked+CL=REACHED",
	}
	for _, want := range expected {
		if !strings.Contains(matrix, want) {
			return fmt.Errorf("semantic-drift witness changed; missing observation %q\n\n%s", want, matrix)
		}
	}

	fmt.Print(matrix)
	return nil
}
