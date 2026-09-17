package main

import (
	"dagger/capability-spike/diagnostic"
	"dagger/capability-spike/reconcile"
	"dagger/capability-spike/runtime"
	"dagger/capability-spike/supervisor"
)

// CapabilityFact/CapabilityGrant/CapabilityObservation/ReconciliationFlag/
// Transition/CapabilityTrace mirror tk-evidence-exporter/pkl/Evidence.pkl's
// classes of the same name field-for-field (json tags match the schema's
// camelCase exactly) so the JSON cmd/trace-export emits is a valid
// CapabilityTrace without this module depending on tk-evidence-exporter's
// Go module -- shape agreement is checked over there by a pkl-go test
// against a captured fixture (testdata/capability_trace_real.json), not by
// a compile-time import. Keep these in sync with Evidence.pkl by hand, the
// same discipline tk-evidence-exporter/internal/evidence/types.go already
// uses for the rest of the contract.
type CapabilityFact struct {
	FactID   string `json:"factId"`
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Vault    string `json:"vault"`
	Message  string `json:"message"`
}

type CapabilityGrant struct {
	FactID   string `json:"factId"`
	Vault    string `json:"vault"`
	Approved bool   `json:"approved"`
}

type CapabilityObservation struct {
	FactID     string `json:"factId"`
	Vault      string `json:"vault"`
	Reason     string `json:"reason"`
	Operation  string `json:"operation"`
	RecordedAt string `json:"recordedAt"`
}

type ReconciliationFlag struct {
	Kind   string `json:"kind"`
	FactID string `json:"factId"`
	Detail string `json:"detail"`
}

// Transition mirrors Evidence.pkl's Transition class -- one step in a
// capability-decision sequence. GoverningRule and the nested fact/flag's
// own message/detail are always text runDemo's real execution actually
// produced (a thrown Ledger.pkl diagnostic, a reconciliation detail
// string) -- never authored here.
type Transition struct {
	Index         int                    `json:"index"`
	Kind          string                 `json:"kind"`
	Label         string                 `json:"label"`
	FactID        *string                `json:"factId"`
	Vault         *string                `json:"vault"`
	GoverningRule *string                `json:"governingRule"`
	Fact          *CapabilityFact        `json:"fact"`
	Grant         *CapabilityGrant       `json:"grant"`
	Observation   *CapabilityObservation `json:"observation"`
	Flag          *ReconciliationFlag    `json:"flag"`
}

// Check mirrors Evidence.pkl's Check class -- a governing rule, kept
// separate from any Transition's recorded state so a consumer always
// computes a verdict rather than replaying one. Constraint must be the
// verbatim source text of the rule it names, never re-authored.
type Check struct {
	ID          string `json:"id"`
	Requirement string `json:"requirement"`
	Constraint  string `json:"constraint"`
	Source      string `json:"source"`
	SourceRef   string `json:"sourceRef"`
}

// CapabilityTrace mirrors Evidence.pkl's CapabilityTrace class.
type CapabilityTrace struct {
	TraceID     string       `json:"traceId"`
	Scenario    string       `json:"scenario"`
	Source      string       `json:"source"`
	SourceRef   string       `json:"sourceRef"`
	Checks      []Check      `json:"checks"`
	Transitions []Transition `json:"transitions"`
}

func factFromDiagnostic(d diagnostic.Diagnostic) *CapabilityFact {
	return &CapabilityFact{FactID: d.FactID, Severity: string(d.Severity), Code: d.Code, Vault: d.Vault, Message: d.Message}
}

func grantOf(g supervisor.Grant) *CapabilityGrant {
	return &CapabilityGrant{FactID: g.FactID, Vault: g.Vault, Approved: g.Approved}
}

func observationOf(o runtime.Observation) *CapabilityObservation {
	return &CapabilityObservation{
		FactID:     o.FactID,
		Vault:      o.Vault,
		Reason:     o.Reason,
		Operation:  o.Operation,
		RecordedAt: o.RecordedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func flagOf(f reconcile.Flag) *ReconciliationFlag {
	return &ReconciliationFlag{Kind: string(f.Kind), FactID: f.FactID, Detail: f.Detail}
}

func strPtr(s string) *string { return &s }
