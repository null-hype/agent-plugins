package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Comparison is the part of a run's comparison.json the server reads.
// Reconcile.pkl writes it; the server only places it on the test that asked.
type Comparison struct {
	RunID     string                `json:"runId"`
	Questions map[string]Reconciled `json:"questions"`
	// Backend per question, from the run's scores.json: a canned answer is
	// labelled as one, never presented as a Jev judgement.
	Backends map[string]string `json:"-"`
}

type Reconciled struct {
	Outcome     string   `json:"outcome"`
	Probability *float64 `json:"probability"`
	Expected    struct {
		Min float64 `json:"min"`
		Max float64 `json:"max"`
	} `json:"expected"`
	BlockedBy []string `json:"blockedBy"`
	Error     *string  `json:"error"`
	// The test that asked it, as Playwright reported it: a file relative to the
	// harness, and a 1-based line and column.
	Location *struct {
		File   string `json:"file"`
		Line   int    `json:"line"`
		Column int    `json:"column"`
	} `json:"location"`
}

type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

type Location struct {
	URI   string `json:"uri"`
	Range Range  `json:"range"`
}

type Diagnostic struct {
	Range    Range  `json:"range"`
	Severity int    `json:"severity"`
	Source   string `json:"source"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

const (
	severityError       = 1
	severityWarning     = 2
	severityInformation = 3
)

// Evidence a peek opens, in this order, when the run recorded it.
var evidenceFiles = []string{"state.json", "request.json", "response.json"}

// latestRun returns the newest run under runsDir that has a comparison.json.
func latestRun(runsDir string) (string, error) {
	entries, err := os.ReadDir(runsDir)
	if err != nil {
		return "", err
	}
	var best string
	var bestTime int64
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, err := os.Stat(filepath.Join(runsDir, e.Name(), "comparison.json"))
		if err != nil {
			continue
		}
		if t := info.ModTime().UnixNano(); best == "" || t > bestTime {
			best, bestTime = filepath.Join(runsDir, e.Name()), t
		}
	}
	if best == "" {
		return "", fmt.Errorf("no run with comparison.json under %s", runsDir)
	}
	return best, nil
}

// findRun picks the run a file is shown against: JEV_RUN_DIR, or the newest
// run under the nearest runs/ directory above the file.
func findRun(path string) (string, error) {
	if dir := os.Getenv("JEV_RUN_DIR"); dir != "" {
		return dir, nil
	}
	for dir := filepath.Dir(path); ; dir = filepath.Dir(dir) {
		if run, err := latestRun(filepath.Join(dir, "runs")); err == nil {
			return run, nil
		}
		if parent := filepath.Dir(dir); parent == dir {
			return "", fmt.Errorf("no run found above %s", path)
		}
	}
}

func loadComparison(runDir string) (Comparison, error) {
	var c Comparison
	b, err := os.ReadFile(filepath.Join(runDir, "comparison.json"))
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	c.Backends = map[string]string{}
	var scores struct {
		Scores map[string]struct {
			Backend string `json:"backend"`
		} `json:"scores"`
	}
	if b, err := os.ReadFile(filepath.Join(runDir, "scores.json")); err == nil && json.Unmarshal(b, &scores) == nil {
		for id, s := range scores.Scores {
			c.Backends[id] = s.Backend
		}
	}
	return c, nil
}

// answerer names who gave the answer, as the run recorded it.
func answerer(backend string) string {
	switch backend {
	case "real":
		return "Jev answered"
	case "mock":
		return "Mock answer"
	default:
		return "Answer"
	}
}

// asked returns, by 0-based line, the questions whose test is in this file.
// One test asks its question of every revision, so a line can hold several.
func asked(path string, c Comparison) map[int][]string {
	out := map[int][]string{}
	slashed := filepath.ToSlash(path)
	for id, q := range c.Questions {
		if q.Location == nil || q.Location.Line < 1 {
			continue
		}
		if slashed == q.Location.File || strings.HasSuffix(slashed, "/"+q.Location.File) {
			out[q.Location.Line-1] = append(out[q.Location.Line-1], id)
		}
	}
	for _, ids := range out {
		sort.Strings(ids)
	}
	return out
}

func diagnostics(path, text string, c Comparison) []Diagnostic {
	lines := strings.Split(text, "\n")
	out := []Diagnostic{}
	byLine := asked(path, c)
	sorted := make([]int, 0, len(byLine))
	for line := range byLine {
		sorted = append(sorted, line)
	}
	sort.Ints(sorted)
	for _, line := range sorted {
		if line >= len(lines) {
			continue
		}
		for _, id := range byLine[line] {
			q := c.Questions[id]
			start := q.Location.Column - 1
			if start < 0 || start > len(lines[line]) {
				start = 0
			}
			d := Diagnostic{
				Range:  Range{Position{line, start}, Position{line, len(strings.TrimRight(lines[line], "\r"))}},
				Source: "jev", Code: q.Outcome,
			}
			switch q.Outcome {
			case "out-of-range":
				d.Severity = severityWarning
				d.Message = fmt.Sprintf("%s: %s %s, outside expected [%g, %g]", id, answerer(c.Backends[id]), score(q.Probability), q.Expected.Min, q.Expected.Max)
			case "execution-failed":
				d.Severity = severityError
				d.Message = id + ": answer could not be collected"
				if q.Error != nil && *q.Error != "" {
					d.Message += ": " + firstLine(*q.Error)
				}
			case "dependency-skipped":
				d.Severity = severityInformation
				d.Message = id + ": skipped, blocked by " + strings.Join(q.BlockedBy, ", ")
			default:
				continue
			}
			out = append(out, d)
		}
	}
	return out
}

// definition returns the evidence behind every question the test on this line asked.
func definition(path string, line int, c Comparison, runDir string) []Location {
	out := []Location{}
	for _, id := range asked(path, c)[line] {
		for _, name := range evidenceFiles {
			p := filepath.Join(runDir, "questions", id, name)
			if _, err := os.Stat(p); err == nil {
				out = append(out, Location{URI: pathToURI(p)})
			}
		}
	}
	return out
}

func score(p *float64) string {
	if p == nil {
		return "none"
	}
	return fmt.Sprintf("%g", *p)
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
