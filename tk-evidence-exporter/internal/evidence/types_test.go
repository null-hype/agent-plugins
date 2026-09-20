package evidence

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestNormalizeEmptyPackageMarshalsArraysNotNull is a regression test for a
// real bug: a Package built with no warnings/checks/snapshots etc. has nil
// Go slices for every Listing<T> field. encoding/json marshals a nil slice
// as `null`, but every one of these fields is a non-nullable Array<T> in
// the generated TypeScript bindings (ts/evidence.pkl.ts) -- a consumer
// parsing `null` where it expects an array breaks. Normalize must close
// that gap before marshaling.
func TestNormalizeEmptyPackageMarshalsArraysNotNull(t *testing.T) {
	pkg := Package{SchemaVersion: SchemaVersion}
	pkg.Normalize()

	data, err := json.Marshal(pkg)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	s := string(data)

	nullFields := []string{
		`"stepRefs":null`, `"checks":null`, `"snapshots":null`, `"fileTree":null`,
		`"diff":null`, `"logs":null`, `"capabilityFacts":null`, `"capabilityGrants":null`,
		`"capabilityObservations":null`, `"reconciliationFlags":null`,
		`"artifactHashes":null`, `"validationErrors":null`,
	}
	for _, f := range nullFields {
		if strings.Contains(s, f) {
			t.Errorf("expected no nil-slice nulls after Normalize, found %s in %s", f, s)
		}
	}

	arrayFields := []string{
		`"stepRefs":[]`, `"checks":[]`, `"snapshots":[]`, `"fileTree":[]`,
		`"diff":[]`, `"logs":[]`, `"capabilityFacts":[]`, `"capabilityGrants":[]`,
		`"capabilityObservations":[]`, `"reconciliationFlags":[]`,
		`"artifactHashes":[]`, `"validationErrors":[]`,
	}
	for _, f := range arrayFields {
		if !strings.Contains(s, f) {
			t.Errorf("expected %s in marshaled output, got %s", f, s)
		}
	}
}
