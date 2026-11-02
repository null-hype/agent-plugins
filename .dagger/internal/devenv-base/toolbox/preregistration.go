package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf16"
)

// Keep findings.json as the check emitted it. Viewers project it; they do not judge.
type claimPreregistration struct {
	File     string          `json:"file"`
	Source   string          `json:"source"`
	Findings json.RawMessage `json:"findings,omitempty"`
}
type claimDiagnostic struct {
	Line     int
	Column   int
	Severity string
	Message  string
	Evidence []string
}
type predictionLine struct {
	Number      int
	Text        string
	Diagnostics []claimDiagnostic
}
type preregistrationView struct {
	File   string
	Source string
	Lines  []predictionLine
	Notice string
}

func projectPreregistration(artifact *claimPreregistration) *preregistrationView {
	if artifact == nil || artifact.File == "" {
		return nil
	}
	view := &preregistrationView{File: artifact.File, Source: artifact.Source}
	for index, text := range strings.Split(artifact.Source, "\n") {
		view.Lines = append(view.Lines, predictionLine{Number: index + 1, Text: text})
	}
	if len(artifact.Findings) == 0 || string(artifact.Findings) == "null" {
		view.Notice = "Findings unavailable for this rerun."
		return view
	}
	var document struct {
		Version  int `json:"version"`
		Findings []struct {
			Location struct {
				File   string `json:"file"`
				Line   int    `json:"line"`
				Column int    `json:"column"`
			} `json:"location"`
			Severity   string   `json:"severity"`
			Message    string   `json:"message"`
			SourceHash string   `json:"sourceHash"`
			Evidence   []string `json:"evidence"`
		} `json:"findings"`
	}
	if json.Unmarshal(artifact.Findings, &document) != nil || document.Version != 1 {
		view.Notice = "Unsupported findings format. Diagnostics unavailable."
		return view
	}
	digest := sha256.Sum256([]byte(artifact.Source))
	hash := "sha256:" + hex.EncodeToString(digest[:])
	placed, omitted := 0, 0
	for _, finding := range document.Findings {
		loc := finding.Location
		matches := loc.File == artifact.File || strings.HasSuffix(loc.File, "/"+artifact.File)
		if !matches || loc.Line < 1 || loc.Line > len(view.Lines) || loc.Column < 1 {
			omitted++
			continue
		}
		line := &view.Lines[loc.Line-1]
		if loc.Column > len(utf16.Encode([]rune(strings.TrimSuffix(line.Text, "\r"))))+1 {
			omitted++
			continue
		}
		message := finding.Message
		if finding.SourceHash != "" && finding.SourceHash != hash {
			message = "stale finding (verified against other source): " + message
		}
		line.Diagnostics = append(line.Diagnostics, claimDiagnostic{loc.Line, loc.Column, finding.Severity, message, finding.Evidence})
		placed++
	}
	switch {
	case omitted > 0:
		view.Notice = fmt.Sprintf("%d finding(s) refer to another file or an invalid location; not placed on this document.", omitted)
	case placed > 0:
		view.Notice = fmt.Sprintf("%d finding(s) from this check.", placed)
	default:
		view.Notice = "No findings on this preregistration."
	}
	return view
}
