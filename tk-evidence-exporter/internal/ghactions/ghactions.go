// Package ghactions reads a workflow run's job/step conclusions from the
// GitHub Actions REST API. This is the structured, authoritative source for
// scenario-level pass/fail/skipped outcomes -- deliberately not derived by
// scraping this workflow's own stdout (devcontainer-test-lib's check/
// reportResults output has no format contract; a GitHub Actions job
// conclusion does).
package ghactions

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"dagger/tk-evidence-exporter/internal/evidence"
)

const defaultBaseURL = "https://api.github.com"

// Step is one step's recorded conclusion within a job.
type Step struct {
	Name       string `json:"name"`
	Number     int    `json:"number"`
	Conclusion string `json:"conclusion"`
}

// Job is one job's recorded conclusion, plus its steps, within a run.
type Job struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Conclusion string `json:"conclusion"`
	HTMLURL    string `json:"html_url"`
	Steps      []Step `json:"steps"`
}

type jobsResponse struct {
	Jobs []Job `json:"jobs"`
}

// Client talks to the GitHub Actions Jobs API for a single repo.
type Client struct {
	HTTPClient *http.Client
	BaseURL    string
	Token      string
}

// NewClient builds a Client using the ambient GITHUB_TOKEN Actions provides.
func NewClient(token string) *Client {
	return &Client{HTTPClient: http.DefaultClient, BaseURL: defaultBaseURL, Token: token}
}

// JobsForRun returns every job (with its steps) for the given run of
// owner/repo.
func (c *Client) JobsForRun(ctx context.Context, ownerRepo, runID string) ([]Job, error) {
	url := fmt.Sprintf("%s/repos/%s/actions/runs/%s/jobs", c.BaseURL, ownerRepo, runID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ghactions: GET %s: %s: %s", url, resp.Status, string(body))
	}

	var parsed jobsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("ghactions: decoding jobs response: %w", err)
	}
	return parsed.Jobs, nil
}

// FindJob returns the job in jobs whose Name matches jobName exactly --
// GITHUB_JOB is the workflow YAML job id, which the Jobs API reports back as
// the job's Name whenever the job has no explicit `name:` override (true of
// test-global.yaml's `test-scenarios` job).
func FindJob(jobs []Job, jobName string) (Job, bool) {
	for _, j := range jobs {
		if j.Name == jobName {
			return j, true
		}
	}
	return Job{}, false
}

// Outcome maps a GitHub Actions job/step conclusion to evidence.Outcome.
// "cancelled", "timed_out", "action_required", and any other unrecognized
// conclusion are treated as failed -- there is no matching Outcome value,
// and silently mapping them to "skipped" or "passed" would misrepresent an
// abnormal run as a normal one.
func Outcome(conclusion string) evidence.Outcome {
	switch conclusion {
	case "success":
		return evidence.OutcomePassed
	case "skipped", "neutral":
		return evidence.OutcomeSkipped
	case "failure":
		return evidence.OutcomeFailed
	default:
		return evidence.OutcomeFailed
	}
}

// StepRefs renders each step as a single human-readable reference string
// ("<name> (<conclusion>)"), preserving step order.
func StepRefs(steps []Step) []string {
	refs := make([]string, 0, len(steps))
	for _, s := range steps {
		refs = append(refs, fmt.Sprintf("%s (%s)", s.Name, s.Conclusion))
	}
	return refs
}
