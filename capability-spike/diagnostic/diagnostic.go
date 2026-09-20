// Package diagnostic models the compiler-style diagnostic the worker
// sees when the supervisor's Ledger.pkl gate rejects a request -- the
// Go-side analog of codespaces-blank's compiler.Diagnostic{severity,
// code, message, taskID, uuid, edge} model, specialized to
// {severity, code, message, factID, vault}.
package diagnostic

import "regexp"

type Severity string

const (
	SeverityError Severity = "error"
)

// CodeTermUnresolved is the one new code CIT-149 adds alongside Ledger.pkl's
// existing CAP_* codes: a reason's phrase does not match anything
// GovernedVocabulary.pkl admits, so there is no factID to check access for
// at all. This is deliberately distinct from CAP_NO_GRANT (see
// resolver.Resolve): a phrase the supervisor never admitted is a different
// failure than one it admitted but never granted.
const CodeTermUnresolved = "CAP_TERM_UNRESOLVED"

type Diagnostic struct {
	Severity Severity `json:"severity"`
	Code     string   `json:"code"`
	Message  string   `json:"message"`
	FactID   string   `json:"factID"`
	Vault    string   `json:"vault"`
}

// thrownPattern matches Ledger.pkl's deny() message format:
// "<CODE> fact=<factID> vault=<vault>: <message>"
var thrownPattern = regexp.MustCompile(`(CAP_[A-Z_]+) fact=(\S+) vault=(\S+): (.+)`)

// Parse extracts a structured Diagnostic from `pkl test` stderr produced
// by a Ledger.pkl rejection. It deliberately matches the specific thrown
// format Ledger.pkl emits rather than treating arbitrary Pkl error text
// as a diagnostic -- an unrelated Pkl error (a typo, a missing import)
// should not be misreported as a capability decision.
func Parse(stderr string) (Diagnostic, bool) {
	m := thrownPattern.FindStringSubmatch(stderr)
	if m == nil {
		return Diagnostic{}, false
	}
	return Diagnostic{
		Severity: SeverityError,
		Code:     m[1],
		FactID:   m[2],
		Vault:    m[3],
		Message:  m[4],
	}, true
}
