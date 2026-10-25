package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Comparison is the part of a run's comparison.json the server reads.
// Reconcile.pkl writes it; the server only projects it onto the .pcf.
type Comparison struct {
	RunID     string                `json:"runId"`
	Questions map[string]Reconciled `json:"questions"`
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

func loadComparison(runDir string) (Comparison, error) {
	var c Comparison
	b, err := os.ReadFile(filepath.Join(runDir, "comparison.json"))
	if err != nil {
		return c, err
	}
	return c, json.Unmarshal(b, &c)
}

// questionRange finds the `["id"]` key that declares the question in the .pcf.
func questionRange(lines []string, id string) (Range, bool) {
	key := `["` + id + `"]`
	for i, line := range lines {
		if col := strings.Index(line, key); col >= 0 {
			return Range{Position{i, col}, Position{i, col + len(key)}}, true
		}
	}
	return Range{}, false
}

// questionAt returns the question whose key is on the given line.
func questionAt(lines []string, line int, c Comparison) (string, bool) {
	if line < 0 || line >= len(lines) {
		return "", false
	}
	for id := range c.Questions {
		if strings.Contains(lines[line], `["`+id+`"]`) {
			return id, true
		}
	}
	return "", false
}

func diagnostics(text string, c Comparison) []Diagnostic {
	lines := strings.Split(text, "\n")
	out := []Diagnostic{}
	for id, q := range c.Questions {
		r, ok := questionRange(lines, id)
		if !ok {
			continue
		}
		d := Diagnostic{Range: r, Source: "jev", Code: q.Outcome}
		switch q.Outcome {
		case "out-of-range":
			d.Severity = severityWarning
			d.Message = fmt.Sprintf("Jev %s outside expected [%g, %g]", score(q.Probability), q.Expected.Min, q.Expected.Max)
		case "execution-failed":
			d.Severity = severityError
			d.Message = "answer could not be collected"
			if q.Error != nil && *q.Error != "" {
				d.Message += ": " + firstLine(*q.Error)
			}
		case "dependency-skipped":
			d.Severity = severityInformation
			d.Message = "skipped: blocked by " + strings.Join(q.BlockedBy, ", ")
		default:
			continue
		}
		out = append(out, d)
	}
	return out
}

func definition(text string, line int, c Comparison, runDir string) []Location {
	id, ok := questionAt(strings.Split(text, "\n"), line, c)
	if !ok {
		return nil
	}
	out := []Location{}
	for _, name := range evidenceFiles {
		p := filepath.Join(runDir, "questions", id, name)
		if _, err := os.Stat(p); err == nil {
			out = append(out, Location{URI: pathToURI(p)})
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
