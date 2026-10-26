package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Run is the entire contract between a verifier and jev-lsp.
// jev-lsp does not care whether the producer was Playwright, a model checker,
// static analysis, an agent audit, CI, or something else.
type Run struct {
	Version  int       `json:"version"`
	Findings []Finding `json:"findings"`
}

type Finding struct {
	ID         string         `json:"id"`
	Location   SourceLocation `json:"location"`
	Severity   string         `json:"severity"`
	Message    string         `json:"message"`
	SourceHash string         `json:"sourceHash,omitempty"`
	Evidence   []string       `json:"evidence,omitempty"`
}

type SourceLocation struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
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
	severityHint        = 4
)

func loadRun(runDir string) (Run, error) {
	var run Run
	b, err := os.ReadFile(filepath.Join(runDir, "findings.json"))
	if err != nil {
		return run, err
	}
	if err := json.Unmarshal(b, &run); err != nil {
		return run, err
	}
	if run.Version != 1 {
		return run, fmt.Errorf("unsupported findings version %d", run.Version)
	}
	return run, nil
}

func matches(path, recorded string) bool {
	path = filepath.ToSlash(path)
	recorded = filepath.ToSlash(recorded)
	return path == recorded || strings.HasSuffix(path, "/"+recorded)
}

func findingsFor(path string, run Run) []Finding {
	var out []Finding
	for _, f := range run.Findings {
		if f.Location.Line > 0 && matches(path, f.Location.File) {
			out = append(out, f)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Location.Line != out[j].Location.Line {
			return out[i].Location.Line < out[j].Location.Line
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func diagnostics(path, text string, run Run) []Diagnostic {
	lines := strings.Split(text, "\n")
	actualHash := hashText(text)
	var out []Diagnostic
	for _, f := range findingsFor(path, run) {
		line := f.Location.Line - 1
		if line < 0 || line >= len(lines) {
			continue
		}
		start := f.Location.Column - 1
		if start < 0 || start > len(lines[line]) {
			start = 0
		}
		sev := severityFor(f.Severity)
		message := f.Message
		if message == "" {
			message = f.ID
		}
		if f.SourceHash != "" && !sameHash(f.SourceHash, actualHash) {
			message = "stale finding (verified against other source): " + message
		}
		out = append(out, Diagnostic{
			Range: Range{
				Start: Position{Line: line, Character: start},
				End:   Position{Line: line, Character: len(strings.TrimRight(lines[line], "\r"))},
			},
			Severity: sev,
			Source:   "jev",
			Code:     f.ID,
			Message:  message,
		})
	}
	return out
}

func definition(path string, line int, run Run, runDir string) []Location {
	var out []Location
	for _, f := range findingsFor(path, run) {
		if f.Location.Line-1 != line {
			continue
		}
		for _, rel := range f.Evidence {
			p := filepath.Join(runDir, filepath.FromSlash(rel))
			if _, err := os.Stat(p); err == nil {
				out = append(out, Location{URI: pathToURI(p)})
			}
		}
	}
	return out
}

func severityFor(s string) int {
	switch strings.ToLower(s) {
	case "error":
		return severityError
	case "info", "information":
		return severityInformation
	case "hint":
		return severityHint
	default:
		return severityWarning
	}
}

func hashText(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

func sameHash(recorded, actual string) bool {
	recorded = strings.TrimSpace(recorded)
	recorded = strings.TrimPrefix(recorded, "sha256:")
	return strings.EqualFold(recorded, actual)
}
