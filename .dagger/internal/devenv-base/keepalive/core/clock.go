package core

import (
	"context"
	"time"
)

// Clock is the time seam KeepAlive sleeps through, so tests can assert the
// 30s(+)-hold guarantee without a real sleep -- see FakeClock in
// fake_clock.go.
type Clock interface {
	Now() time.Time
	// Sleep blocks for d, or until ctx is done, whichever comes first.
	Sleep(ctx context.Context, d time.Duration)
}

// RealClock is the production Clock.
type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }

func (RealClock) Sleep(ctx context.Context, d time.Duration) {
	if d <= 0 {
		return
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
	case <-ctx.Done():
	}
}
