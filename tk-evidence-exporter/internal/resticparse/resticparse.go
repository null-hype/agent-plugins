// Package resticparse wraps restic's own `--json` output for snapshots, ls,
// and diff into evidence types. Unlike the devcontainer-test-lib log (see
// internal/ghactions's doc comment), restic's --json output is already a
// real structured format restic itself defines and versions -- this package
// only reshapes it, it never scrapes text.
package resticparse

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"

	"dagger/tk-evidence-exporter/internal/evidence"
)

type snapshotJSON struct {
	Time    string   `json:"time"`
	Tags    []string `json:"tags"`
	ID      string   `json:"id"`
	ShortID string   `json:"short_id"`
}

// ParseSnapshots parses `restic snapshots --json` output (a JSON array).
func ParseSnapshots(data []byte) ([]evidence.SnapshotRef, error) {
	var raw []snapshotJSON
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("resticparse: decoding restic snapshots --json: %w", err)
	}
	refs := make([]evidence.SnapshotRef, 0, len(raw))
	for _, s := range raw {
		tag := ""
		if len(s.Tags) > 0 {
			tag = s.Tags[0]
		}
		refs = append(refs, evidence.SnapshotRef{
			ID:      s.ID,
			ShortID: s.ShortID,
			Tag:     tag,
			TakenAt: s.Time,
		})
	}
	return refs, nil
}

// lsLine is the shape of every line `restic ls <id> --json` emits: the
// first line is a "snapshot" header (no "type"/"path"), every following
// line is a "node" describing one file/dir.
type lsLine struct {
	StructType string `json:"struct_type"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Path       string `json:"path"`
	Size       *int64 `json:"size"`
}

// ParseLS parses `restic ls <snapshotID> --json` output (JSON Lines: one
// snapshot header line, followed by one node line per file/dir).
func ParseLS(data []byte) ([]evidence.FileTreeEntry, error) {
	var entries []evidence.FileTreeEntry
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var l lsLine
		if err := json.Unmarshal(line, &l); err != nil {
			return nil, fmt.Errorf("resticparse: decoding restic ls --json line: %w", err)
		}
		if l.StructType != "node" {
			continue // the leading "snapshot" header line, or a future struct_type
		}
		entries = append(entries, evidence.FileTreeEntry{
			Path: l.Path,
			Type: l.Type,
			Size: l.Size,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("resticparse: scanning restic ls --json: %w", err)
	}
	return entries, nil
}

// diffLine is the shape of every line `restic diff <id1> <id2> --json`
// emits: "change" lines carry one changed path each, and a trailing
// "statistics" line summarizes the whole diff (skipped here -- the
// evidence schema's DiffEntry is per-path, not a summary).
type diffLine struct {
	MessageType string `json:"message_type"`
	Path        string `json:"path"`
	Modifier    string `json:"modifier"`
}

// ParseDiff parses `restic diff <id1> <id2> --json` output (JSON Lines) into
// per-path DiffEntry values. Only present when a scenario has at least two
// snapshots to compare -- see the evidence schema's doc comment on DiffEntry.
func ParseDiff(data []byte) ([]evidence.DiffEntry, error) {
	var entries []evidence.DiffEntry
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var l diffLine
		if err := json.Unmarshal(line, &l); err != nil {
			return nil, fmt.Errorf("resticparse: decoding restic diff --json line: %w", err)
		}
		if l.MessageType != "change" {
			continue // the trailing "statistics" summary line
		}
		entries = append(entries, evidence.DiffEntry{
			Path:       l.Path,
			ChangeType: changeType(l.Modifier),
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("resticparse: scanning restic diff --json: %w", err)
	}
	return entries, nil
}

// changeType maps restic diff's single-character modifier to the schema's
// "added"|"removed"|"modified". restic also emits "T" (type changed) and
// "U" (metadata/ownership changed); both are folded into "modified" since
// the schema doesn't distinguish content changes from metadata-only ones.
func changeType(modifier string) string {
	switch modifier {
	case "+":
		return "added"
	case "-":
		return "removed"
	default:
		return "modified"
	}
}
