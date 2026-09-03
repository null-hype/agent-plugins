package core

import (
	"context"
	"fmt"
)

// FakeResponse is one scripted (output, err) pair for FakeTunnel.Run.
type FakeResponse struct {
	Output string
	Err    error
}

// FakeTunnel is a Tunnel for tests: no real devpod session, just recorded
// calls and scripted responses. Kept in the package (not a _test.go file)
// so both this package's own tests and the retry package's tests -- which
// need to drive the retry state machine without a live devpod/GCP
// workspace -- can use it.
type FakeTunnel struct {
	Opened   bool
	Closed   bool
	Restarts int

	// Calls records every method invocation in order, e.g.
	// "open", "run:tailscale-up.sh", "restart", "close" -- lets a test
	// assert call ordering, not just outcomes.
	Calls []string

	// Responses maps a script name to a queue of responses Run returns for
	// that script, one per call -- so a test can script "fails once, then
	// succeeds after Restart". Run errors if the queue for a script is
	// empty when called.
	Responses map[string][]FakeResponse

	OpenErr  error
	CloseErr error
}

// NewFakeTunnel returns a FakeTunnel ready for a test to populate Responses
// on.
func NewFakeTunnel() *FakeTunnel {
	return &FakeTunnel{Responses: map[string][]FakeResponse{}}
}

func (f *FakeTunnel) Open(ctx context.Context) error {
	f.Calls = append(f.Calls, "open")
	if f.OpenErr != nil {
		return f.OpenErr
	}
	f.Opened = true
	return nil
}

func (f *FakeTunnel) Run(ctx context.Context, script string, extraEnv ...string) (string, error) {
	f.Calls = append(f.Calls, "run:"+script)
	queue := f.Responses[script]
	if len(queue) == 0 {
		return "", fmt.Errorf("fake tunnel: no response scripted for %q (call %d)", script, len(f.Calls))
	}
	resp := queue[0]
	f.Responses[script] = queue[1:]
	return resp.Output, resp.Err
}

func (f *FakeTunnel) Restart(ctx context.Context) error {
	f.Calls = append(f.Calls, "restart")
	f.Restarts++
	return nil
}

func (f *FakeTunnel) Close() error {
	f.Calls = append(f.Calls, "close")
	f.Closed = true
	return f.CloseErr
}
