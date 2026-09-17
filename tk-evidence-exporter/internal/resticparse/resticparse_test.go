package resticparse

import (
	"os"
	"testing"
)

// Fixtures are real `restic snapshots/ls/diff --json` output captured
// against a scratch restic repo with two backups of the same tagged path
// (see tk-evidence-exporter's plan notes) -- not hand-authored JSON.

func TestParseSnapshots(t *testing.T) {
	data, err := os.ReadFile("testdata/snapshots.json")
	if err != nil {
		t.Fatal(err)
	}
	refs, err := ParseSnapshots(data)
	if err != nil {
		t.Fatalf("ParseSnapshots: %v", err)
	}
	if len(refs) != 2 {
		t.Fatalf("expected 2 snapshots, got %d", len(refs))
	}
	if refs[0].Tag != "restic-backup" {
		t.Errorf("unexpected tag: %q", refs[0].Tag)
	}
	if refs[1].ShortID != "bcdd5068" {
		t.Errorf("unexpected short id: %q", refs[1].ShortID)
	}
	if refs[0].ID == "" || refs[0].TakenAt == "" {
		t.Errorf("expected non-empty id/takenAt, got %+v", refs[0])
	}
}

func TestParseLS(t *testing.T) {
	data, err := os.ReadFile("testdata/ls.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	snapshotID, entries, err := ParseLS(data)
	if err != nil {
		t.Fatalf("ParseLS: %v", err)
	}
	if snapshotID != "bcdd5068c04dfd711c5ddce3188664d1839c5efb2aa232f40bc2127a9f62661a" {
		t.Errorf("unexpected snapshot id from the header line: %q", snapshotID)
	}
	// The header "snapshot" line must be excluded; every remaining node
	// line (dirs + files, including restic's ancestor-directory entries)
	// must be present.
	if len(entries) != 7 {
		t.Fatalf("expected 7 file-tree entries (excluding the snapshot header), got %d: %+v", len(entries), entries)
	}

	var sawFile, sawDir bool
	for _, e := range entries {
		if e.SnapshotID != snapshotID {
			t.Errorf("%s: expected snapshotId %q stamped from the header line, got %q", e.Path, snapshotID, e.SnapshotID)
		}
		if e.Path == "/tmp/restic-fixture-src/.claude/projects/session-b.jsonl" {
			sawFile = true
			if e.Type != "file" {
				t.Errorf("session-b.jsonl: expected type file, got %q", e.Type)
			}
			if e.Size == nil || *e.Size != 7 {
				t.Errorf("session-b.jsonl: expected size 7, got %v", e.Size)
			}
		}
		if e.Path == "/tmp/restic-fixture-src/.claude/projects" {
			sawDir = true
			if e.Type != "dir" {
				t.Errorf(".claude/projects: expected type dir, got %q", e.Type)
			}
		}
	}
	if !sawFile {
		t.Error("expected to see session-b.jsonl in the file tree")
	}
	if !sawDir {
		t.Error("expected to see .claude/projects in the file tree")
	}
}

func TestParseDiff(t *testing.T) {
	data, err := os.ReadFile("testdata/diff.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := ParseDiff(data)
	if err != nil {
		t.Fatalf("ParseDiff: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 diff entries (statistics line excluded), got %d: %+v", len(entries), entries)
	}

	byPath := map[string]string{}
	for _, e := range entries {
		byPath[e.Path] = e.ChangeType
		if e.FromSnapshotID != "d543a8f00a0407c733508a78e2fd571965c77681a0d52259a539eae2ae0c56d0" {
			t.Errorf("%s: unexpected fromSnapshotId: %q", e.Path, e.FromSnapshotID)
		}
		if e.ToSnapshotID != "bcdd5068c04dfd711c5ddce3188664d1839c5efb2aa232f40bc2127a9f62661a" {
			t.Errorf("%s: unexpected toSnapshotId: %q", e.Path, e.ToSnapshotID)
		}
	}
	if got := byPath["/tmp/restic-fixture-src/.claude/projects/session-b.jsonl"]; got != "added" {
		t.Errorf("session-b.jsonl: expected added, got %q", got)
	}
	if got := byPath["/tmp/restic-fixture-src/.claude/shared.txt"]; got != "modified" {
		t.Errorf("shared.txt: expected modified, got %q", got)
	}
}
