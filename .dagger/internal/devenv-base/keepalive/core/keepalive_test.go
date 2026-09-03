package core

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestKeepAlive_HoldsSessionOpenPastMinDurationWhenStepsReturnInstantly(t *testing.T) {
	clock := NewFakeClock(time.Unix(0, 0))
	tunnel := NewFakeTunnel()

	ranSteps := false
	steps := func(ctx context.Context, tun Tunnel) error {
		ranSteps = true
		return nil // returns instantly -- no clock advance at all
	}

	err := KeepAlive(context.Background(), clock, tunnel, 45*time.Second, steps)
	if err != nil {
		t.Fatalf("KeepAlive returned error: %v", err)
	}
	if !ranSteps {
		t.Fatal("steps was never invoked")
	}
	if !tunnel.Closed {
		t.Fatal("tunnel was never closed")
	}
	if len(clock.Slept) != 1 || clock.Slept[0] != 45*time.Second {
		t.Fatalf("expected a single 45s sleep to cover the whole minDuration since steps took none of it, got %v", clock.Slept)
	}
	wantCalls := []string{"open", "close"}
	if !equalSlices(tunnel.Calls, wantCalls) {
		t.Fatalf("tunnel.Calls = %v, want %v", tunnel.Calls, wantCalls)
	}
}

func TestKeepAlive_DoesNotOversleepWhenStepsAlreadyRanLong(t *testing.T) {
	clock := NewFakeClock(time.Unix(0, 0))
	tunnel := NewFakeTunnel()

	steps := func(ctx context.Context, tun Tunnel) error {
		clock.Advance(60 * time.Second) // already past the 45s minDuration
		return nil
	}

	if err := KeepAlive(context.Background(), clock, tunnel, 45*time.Second, steps); err != nil {
		t.Fatalf("KeepAlive returned error: %v", err)
	}
	if len(clock.Slept) != 0 {
		t.Fatalf("expected no extra sleep once steps already exceeded minDuration, got %v", clock.Slept)
	}
	if !tunnel.Closed {
		t.Fatal("tunnel was never closed")
	}
}

func TestKeepAlive_SleepsOnlyTheRemainder(t *testing.T) {
	clock := NewFakeClock(time.Unix(0, 0))
	tunnel := NewFakeTunnel()

	steps := func(ctx context.Context, tun Tunnel) error {
		clock.Advance(10 * time.Second)
		return nil
	}

	if err := KeepAlive(context.Background(), clock, tunnel, 45*time.Second, steps); err != nil {
		t.Fatalf("KeepAlive returned error: %v", err)
	}
	if len(clock.Slept) != 1 || clock.Slept[0] != 35*time.Second {
		t.Fatalf("expected a 35s sleep (45s minDuration - 10s already elapsed), got %v", clock.Slept)
	}
}

func TestKeepAlive_ClosesTunnelAndStillHoldsMinDurationEvenWhenStepsFail(t *testing.T) {
	clock := NewFakeClock(time.Unix(0, 0))
	tunnel := NewFakeTunnel()
	stepsErr := errors.New("bootstrap step exploded")

	steps := func(ctx context.Context, tun Tunnel) error {
		return stepsErr
	}

	err := KeepAlive(context.Background(), clock, tunnel, 45*time.Second, steps)
	if !errors.Is(err, stepsErr) {
		t.Fatalf("KeepAlive error = %v, want it to wrap %v", err, stepsErr)
	}
	if !tunnel.Closed {
		t.Fatal("tunnel must still be closed when steps fails")
	}
	if len(clock.Slept) != 1 || clock.Slept[0] != 45*time.Second {
		t.Fatalf("expected KeepAlive to still hold the full minDuration on a steps failure, got %v", clock.Slept)
	}
}

func TestKeepAlive_ReturnsOpenErrorWithoutRunningStepsOrSleeping(t *testing.T) {
	clock := NewFakeClock(time.Unix(0, 0))
	tunnel := NewFakeTunnel()
	tunnel.OpenErr = errors.New("devpod ssh: connection refused")

	ranSteps := false
	steps := func(ctx context.Context, tun Tunnel) error {
		ranSteps = true
		return nil
	}

	if err := KeepAlive(context.Background(), clock, tunnel, 45*time.Second, steps); err == nil {
		t.Fatal("expected KeepAlive to propagate the Open error")
	}
	if ranSteps {
		t.Fatal("steps must not run when Open fails")
	}
	if len(clock.Slept) != 0 {
		t.Fatalf("expected no sleep when Open fails, got %v", clock.Slept)
	}
	if tunnel.Closed {
		t.Fatal("Close should not be called for a tunnel that never opened")
	}
}

func equalSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
