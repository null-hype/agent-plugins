// Package pkljunit parses the JUnit XML `pkl test --junit-reports` emits.
// This is the structured test-runner output CIT-146's future capability-spike
// scenario produces -- distinct from, and more reliable than, scraping
// devcontainer-test-lib's bash-wrapped stdout: a `pkl test` failure carries
// the exact `CAP_* fact=<id> vault=<v>: <message>` diagnostic string as a
// JUnit `<failure message>` attribute, not free text mixed into a log.
package pkljunit

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"regexp"

	"dagger/tk-evidence-exporter/internal/evidence"
)

// capDiagnostic matches the fixed, structured format Ledger.pkl's deny()
// throws (capability-spike/pkl/Ledger.pkl) and diagnostic.Parse regex-matches
// on the Go side: "<code> fact=<factID> vault=<vault>: <message>". `pkl
// test`'s JUnit reporter has no way to distinguish "the fact was correctly
// denied" from "evaluation broke for an unrelated reason" -- both surface as
// a bare <error>. Matching this format is what recovers that distinction:
// a match means the domain check ran and produced a real (expected-red)
// verdict; no match means something actually went wrong in evaluation.
var capDiagnostic = regexp.MustCompile(`^(CAP_[A-Z_]+) fact=(\S+) vault=(\S+): (.+)$`)

type testSuites struct {
	Suites []testSuite `xml:"testsuite"`
}

type testSuite struct {
	Name      string     `xml:"name,attr"`
	Testcases []testCase `xml:"testcase"`
}

type testCase struct {
	ClassName string     `xml:"classname,attr"`
	Name      string     `xml:"name,attr"`
	Failure   *xmlDetail `xml:"failure"`
	Error     *xmlDetail `xml:"error"`
	Skipped   *xmlDetail `xml:"skipped"`
}

type xmlDetail struct {
	Message string `xml:"message,attr"`
	Body    string `xml:",chardata"`
}

// Parse decodes one `pkl test --junit-reports` XML document into
// evidence.CheckResult values, one per `facts{}` test case. `pkl test`
// writes one file per module by default (root element `<testsuite>`); it
// accepts a `<testsuites>` root too, in case that ever changes.
func Parse(data []byte) ([]evidence.CheckResult, error) {
	rootName, err := rootElementName(data)
	if err != nil {
		return nil, fmt.Errorf("pkljunit: decoding JUnit XML: %w", err)
	}

	var suites testSuites
	switch rootName {
	case "testsuites":
		if err := xml.Unmarshal(data, &suites); err != nil {
			return nil, fmt.Errorf("pkljunit: decoding JUnit XML: %w", err)
		}
	default: // "testsuite", or anything else -- treat as a single suite
		var single testSuite
		if err := xml.Unmarshal(data, &single); err != nil {
			return nil, fmt.Errorf("pkljunit: decoding JUnit XML: %w", err)
		}
		suites.Suites = []testSuite{single}
	}

	var results []evidence.CheckResult
	for _, suite := range suites.Suites {
		for _, tc := range suite.Testcases {
			label := tc.Name
			if tc.ClassName != "" {
				label = tc.ClassName + "/" + tc.Name
			}
			results = append(results, toCheckResult(label, tc))
		}
	}
	return results, nil
}

func toCheckResult(label string, tc testCase) evidence.CheckResult {
	switch {
	case tc.Error != nil:
		detail := detailText(tc.Error)
		if capDiagnostic.MatchString(detail) {
			// A structured CAP_* denial: the boundary ran and produced a
			// real domain verdict (rejected/no-grant/mismatch), not a
			// broken evaluation -- record it as failed, not eval-error.
			return evidence.CheckResult{Label: label, Outcome: evidence.OutcomeFailed, Detail: &detail}
		}
		return evidence.CheckResult{Label: label, Outcome: evidence.OutcomeEvalError, Detail: &detail}
	case tc.Failure != nil:
		detail := detailText(tc.Failure)
		return evidence.CheckResult{Label: label, Outcome: evidence.OutcomeFailed, Detail: &detail}
	case tc.Skipped != nil:
		detail := detailText(tc.Skipped)
		return evidence.CheckResult{Label: label, Outcome: evidence.OutcomeSkipped, Detail: &detail}
	default:
		return evidence.CheckResult{Label: label, Outcome: evidence.OutcomePassed}
	}
}

// rootElementName returns the root element's local name without decoding
// the whole document -- just enough to pick which struct to unmarshal into.
func rootElementName(data []byte) (string, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return "", fmt.Errorf("no root element found")
		}
		if err != nil {
			return "", err
		}
		if start, ok := tok.(xml.StartElement); ok {
			return start.Name.Local, nil
		}
	}
}

func detailText(d *xmlDetail) string {
	if d.Message != "" {
		return d.Message
	}
	return d.Body
}

// ParseDiagnostic extracts the structured CAP_* fields from a detail string
// matching Ledger.pkl's thrown format (see capDiagnostic), mirroring
// diagnostic.Parse on the capability-spike side. ok is false when detail
// isn't a CAP_* diagnostic at all (e.g. a genuine eval-error).
func ParseDiagnostic(detail string) (code, factID, vault, message string, ok bool) {
	m := capDiagnostic.FindStringSubmatch(detail)
	if m == nil {
		return "", "", "", "", false
	}
	return m[1], m[2], m[3], m[4], true
}
