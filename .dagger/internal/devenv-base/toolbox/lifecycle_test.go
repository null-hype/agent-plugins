package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// lifecycleHost runs host-lifecycle.sh against a temp state and jobs dir,
// a fake clock, and fakes for pgrep, su and devpod. poweroff touches a file.
type lifecycleHost struct {
	t                     *testing.T
	dir, state, jobs      string
	idle, lease, ext, max int
	agent                 bool
}

const t0 = 1_800_000_000

func newLifecycleHost(t *testing.T) *lifecycleHost {
	for _, tool := range []string{"bash", "jq", "paste"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s not installed", tool)
		}
	}
	dir := t.TempDir()
	h := &lifecycleHost{t: t, dir: dir, state: filepath.Join(dir, "state"), jobs: filepath.Join(dir, "jobs"),
		idle: 15, lease: 120, ext: 15, max: 240}
	os.MkdirAll(h.jobs, 0o755)
	bin := filepath.Join(dir, "bin")
	os.Mkdir(bin, 0o755)
	for name, script := range map[string]string{
		// Only the agent's process can be found, and only when the test says so.
		"pgrep": `[ "$1 $2" = "-f claude-agent-sdk" ] && [ -f "$FAKE_DIR/agent" ]`,
		// su - user -c CMD: run CMD here.
		"su":     `shift 3; bash -c "$1"`,
		"devpod": `echo "$*" >> "$FAKE_DIR/devpod.calls"; [ "$1" = list ] && echo '[{"id":"linear-agent"}]'; exit 0`,
	} {
		os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/bash\n"+script+"\n"), 0o755)
	}
	return h
}

func (h *lifecycleHost) run(at int, action string) string {
	h.t.Helper()
	if h.agent {
		os.WriteFile(filepath.Join(h.dir, "agent"), nil, 0o644)
	} else {
		os.Remove(filepath.Join(h.dir, "agent"))
	}
	cmd := exec.Command("bash", "host-lifecycle.sh", action)
	cmd.Env = []string{
		"PATH=" + filepath.Join(h.dir, "bin") + ":" + os.Getenv("PATH"),
		"FAKE_DIR=" + h.dir,
		"LIFECYCLE_STATE_DIR=" + h.state, "LIFECYCLE_JOBS_DIR=" + h.jobs,
		"LIFECYCLE_NOW=" + strconv.Itoa(t0+at*60),
		"LIFECYCLE_IDLE_MIN=" + strconv.Itoa(h.idle), "LIFECYCLE_LEASE_MIN=" + strconv.Itoa(h.lease),
		"LIFECYCLE_EXTEND_MIN=" + strconv.Itoa(h.ext), "LIFECYCLE_MAX_MIN=" + strconv.Itoa(h.max),
		"LIFECYCLE_POWEROFF=touch " + filepath.Join(h.dir, "poweroff"),
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		h.t.Fatalf("%s at +%dm: %v\n%s", action, at, err, out)
	}
	return string(out)
}

func (h *lifecycleHost) stopped() string {
	if _, err := os.Stat(filepath.Join(h.dir, "poweroff")); err != nil {
		return ""
	}
	b, _ := os.ReadFile(filepath.Join(h.state, "last-stop"))
	return strings.TrimSpace(string(b))
}

// job writes a pid file for a job; a live one points at a sleeping process.
func (h *lifecycleHost) job(id string, live bool) {
	pid := 999999
	if live {
		p := exec.Command("sleep", "60")
		p.Start()
		h.t.Cleanup(func() { p.Process.Kill(); p.Wait() })
		pid = p.Process.Pid
	}
	os.WriteFile(filepath.Join(h.jobs, id+".pid"), []byte(strconv.Itoa(pid)), 0o644)
}

func TestLifecycleIdleShutdownIgnoresPolls(t *testing.T) {
	h := newLifecycleHost(t)
	h.run(0, "boot")
	// Polls and tool calls start no job and no agent: nothing to keep it up.
	for _, at := range []int{1, 5, 10, 14} {
		h.run(at, "status")
		h.run(at, "tick")
	}
	if why := h.stopped(); why != "" {
		t.Fatalf("stopped before 15 idle minutes: %s", why)
	}
	h.run(15, "tick")
	if why := h.stopped(); !strings.HasPrefix(why, "idle for 15 min") {
		t.Fatalf("after 15 idle minutes: stopped %q", why)
	}
	calls, _ := os.ReadFile(filepath.Join(h.dir, "devpod.calls"))
	if !strings.Contains(string(calls), "stop linear-agent") || strings.Contains(string(calls), "delete") {
		t.Fatalf("workspaces were not stopped, or were deleted, before poweroff:\n%s", calls)
	}
}

func TestLifecycleWorkResetsTheIdleClock(t *testing.T) {
	h := newLifecycleHost(t)
	h.run(0, "boot")
	h.agent = true
	h.run(10, "tick")
	h.agent = false
	h.run(24, "tick")
	if why := h.stopped(); why != "" {
		t.Fatalf("stopped 14 minutes after the agent's last work: %s", why)
	}
	h.job("ship", true)
	h.run(30, "tick")
	os.Remove(filepath.Join(h.jobs, "ship.pid"))
	h.run(44, "tick")
	if why := h.stopped(); why != "" {
		t.Fatalf("stopped 14 minutes after a ship job: %s", why)
	}
	h.run(45, "tick")
	if h.stopped() == "" {
		t.Fatal("not stopped 15 minutes after the last work")
	}
}

func TestLifecycleLeaseExtendsOnlyForWorkUpToTheHardCap(t *testing.T) {
	h := newLifecycleHost(t)
	h.lease, h.ext, h.max, h.idle = 30, 15, 60, 100
	h.run(0, "boot")
	h.job("review-7", true)
	h.run(30, "tick") // deadline 30 -> 45
	h.run(45, "tick") // 45 -> 60, the cap
	if why := h.stopped(); why != "" {
		t.Fatalf("stopped while extending: %s", why)
	}
	var st struct {
		Busy       []string `json:"busy"`
		Extensions int      `json:"extensions"`
		LeaseLeft  int      `json:"lease_seconds_left"`
		CapLeft    int      `json:"hard_cap_seconds_left"`
	}
	if err := json.Unmarshal([]byte(h.run(50, "status")), &st); err != nil {
		t.Fatal(err)
	}
	if st.Extensions != 2 || st.LeaseLeft != 10*60 || st.CapLeft != 10*60 || len(st.Busy) != 1 || st.Busy[0] != "job:review-7" {
		t.Fatalf("status %+v", st)
	}
	// The cap holds even with the job still running.
	h.run(60, "tick")
	if why := h.stopped(); !strings.HasPrefix(why, "hard cap of 60 min reached with job:review-7") {
		t.Fatalf("at the hard cap: stopped %q", why)
	}
}

func TestLifecycleLeaseEndsWithoutWork(t *testing.T) {
	h := newLifecycleHost(t)
	h.lease, h.idle = 10, 15
	h.run(0, "boot")
	h.run(10, "tick")
	if why := h.stopped(); why != "lease ended with no work in progress" {
		t.Fatalf("at the end of the lease: stopped %q", why)
	}
}

func TestLifecycleBootMarksInterruptedJobs(t *testing.T) {
	h := newLifecycleHost(t)
	// Left by the last boot: a ship that never finished, a review that did,
	// and the agent workspace's start, which said the agent was up.
	h.job("ship", false)
	h.job("review-7", false)
	os.WriteFile(filepath.Join(h.jobs, "review-7.exit"), []byte("0\n"), 0o644)
	os.WriteFile(filepath.Join(h.jobs, "linear-agent.exit"), []byte("0\n"), 0o644)
	h.run(0, "boot")
	read := func(name string) string {
		b, _ := os.ReadFile(filepath.Join(h.jobs, name))
		return strings.TrimSpace(string(b))
	}
	if read("ship.exit") != "130" || read("ship.interrupted") == "" {
		t.Fatalf("unfinished ship: exit %q, marker %q", read("ship.exit"), read("ship.interrupted"))
	}
	if read("review-7.exit") != "0" || read("review-7.interrupted") != "" {
		t.Fatal("a finished review's result was changed")
	}
	if read("linear-agent.exit") != "" || read("linear-agent.exit.lastboot") != "0" {
		t.Fatal("last boot's agent start still reads as this boot's")
	}
	if m, _ := filepath.Glob(filepath.Join(h.jobs, "*.pid")); len(m) != 0 {
		t.Fatalf("stale pid files left: %v", m)
	}
}
