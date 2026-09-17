package ghactions

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"dagger/tk-evidence-exporter/internal/evidence"
)

func TestJobsForRunAndFindJob(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got, want := r.URL.Path, "/repos/null-hype/agent-plugins/actions/runs/42/jobs"; got != want {
			t.Fatalf("unexpected path: got %q want %q", got, want)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("unexpected auth header: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"jobs": [
				{
					"id": 1,
					"name": "test-scenarios",
					"conclusion": "success",
					"html_url": "https://github.com/null-hype/agent-plugins/actions/runs/42/job/1",
					"steps": [
						{"name": "Set up job", "number": 1, "conclusion": "success"},
						{"name": "Testing all scenarios (feature-local and global)", "number": 2, "conclusion": "success"}
					]
				}
			]
		}`))
	}))
	defer srv.Close()

	c := NewClient("test-token")
	c.BaseURL = srv.URL

	jobs, err := c.JobsForRun(context.Background(), "null-hype/agent-plugins", "42")
	if err != nil {
		t.Fatalf("JobsForRun: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected 1 job, got %d", len(jobs))
	}

	job, ok := FindJob(jobs, "test-scenarios")
	if !ok {
		t.Fatal("expected to find test-scenarios job")
	}
	if job.Conclusion != "success" {
		t.Fatalf("unexpected conclusion: %q", job.Conclusion)
	}
	if len(job.Steps) != 2 {
		t.Fatalf("expected 2 steps, got %d", len(job.Steps))
	}

	if _, ok := FindJob(jobs, "does-not-exist"); ok {
		t.Fatal("expected no match for unknown job name")
	}
}

func TestOutcome(t *testing.T) {
	cases := map[string]evidence.Outcome{
		"success":          evidence.OutcomePassed,
		"failure":          evidence.OutcomeFailed,
		"skipped":          evidence.OutcomeSkipped,
		"neutral":          evidence.OutcomeSkipped,
		"cancelled":        evidence.OutcomeFailed,
		"timed_out":        evidence.OutcomeFailed,
		"action_required":  evidence.OutcomeFailed,
		"something-future": evidence.OutcomeFailed,
	}
	for conclusion, want := range cases {
		if got := Outcome(conclusion); got != want {
			t.Errorf("Outcome(%q) = %q, want %q", conclusion, got, want)
		}
	}
}

func TestStepRefs(t *testing.T) {
	refs := StepRefs([]Step{
		{Name: "Set up job", Conclusion: "success"},
		{Name: "Testing all scenarios (feature-local and global)", Conclusion: "success"},
	})
	want := []string{
		"Set up job (success)",
		"Testing all scenarios (feature-local and global) (success)",
	}
	if len(refs) != len(want) {
		t.Fatalf("got %d refs, want %d", len(refs), len(want))
	}
	for i := range want {
		if refs[i] != want[i] {
			t.Errorf("refs[%d] = %q, want %q", i, refs[i], want[i])
		}
	}
}
