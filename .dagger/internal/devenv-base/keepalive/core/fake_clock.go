package core

import (
	"context"
	"time"
)

// FakeClock is a Clock for tests: Sleep advances Now() immediately instead
// of actually blocking, and records requested durations so a test can
// assert KeepAlive requested (at least) the remaining time up to
// minDuration -- without a real sleep in the test suite.
type FakeClock struct {
	now   time.Time
	Slept []time.Duration
}

// NewFakeClock returns a FakeClock starting at start.
func NewFakeClock(start time.Time) *FakeClock {
	return &FakeClock{now: start}
}

func (c *FakeClock) Now() time.Time { return c.now }

func (c *FakeClock) Sleep(ctx context.Context, d time.Duration) {
	c.Slept = append(c.Slept, d)
	c.now = c.now.Add(d)
}

// Advance moves the clock forward by d without recording a Sleep call --
// for simulating steps() itself taking wall-clock time.
func (c *FakeClock) Advance(d time.Duration) {
	c.now = c.now.Add(d)
}
