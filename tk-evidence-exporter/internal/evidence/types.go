// Package evidence mirrors tk-evidence-exporter/pkl/Evidence.pkl field for
// field. These are both the values internal/export renders into a generated
// Pkl instance and the shape pkl-go evaluates that instance back into, so a
// drift between this file and Evidence.pkl surfaces as a pkl-go decode error
// rather than silently diverging.
package evidence

// Outcome mirrors the Pkl typealias of the same name. This is a Go type
// *alias* (= string), not a defined type: pkl-go's evaluator silently
// leaves a defined string type (`type Outcome string`) at its zero value
// when decoding a Pkl typealias-of-string-literals property, while decoding
// the identical value correctly into a plain `string` field -- confirmed
// with a minimal repro against pkl-go v0.13.2. Every pkl-tagged struct
// field using Outcome/FlagKind therefore needs the field's underlying type
// to be exactly `string`, which a Go alias (unlike a defined type)
// guarantees.
type Outcome = string

const (
	OutcomePassed    Outcome = "passed"
	OutcomeFailed    Outcome = "failed"
	OutcomeSkipped   Outcome = "skipped"
	OutcomeEvalError Outcome = "eval-error"
)

// FlagKind mirrors reconcile.FlagKind (capability-spike/reconcile/reconcile.go).
// A Go alias for the same pkl-go decoding reason as Outcome above.
type FlagKind = string

const (
	FlagUnapprovedMaterialization FlagKind = "unapproved-materialization"
	FlagMissingMaterialization    FlagKind = "missing-materialization"
	FlagReasonMismatch            FlagKind = "reason-mismatch"
	FlagBoundaryBypassed          FlagKind = "boundary-bypassed"
)

type ExecutionIdentity struct {
	SourceRevision      string   `pkl:"sourceRevision"`
	WorkflowRunID       string   `pkl:"workflowRunId"`
	WorkflowRunAttempt  string   `pkl:"workflowRunAttempt"`
	RunURL              string   `pkl:"runUrl"`
	JobName             string   `pkl:"jobName"`
	StepRefs            []string `pkl:"stepRefs"`
	ScenarioName        string   `pkl:"scenarioName"`
}

type CheckResult struct {
	Label   string  `pkl:"label"`
	Outcome Outcome `pkl:"outcome"`
	Detail  *string `pkl:"detail"`
}

type ScenarioResult struct {
	ScenarioName string        `pkl:"scenarioName"`
	Outcome      Outcome       `pkl:"outcome"`
	Checks       []CheckResult `pkl:"checks"`
}

type SnapshotRef struct {
	ID      string `pkl:"id"`
	ShortID string `pkl:"shortId"`
	Tag     string `pkl:"tag"`
	TakenAt string `pkl:"takenAt"`
}

type FileTreeEntry struct {
	Path string `pkl:"path"`
	Type string `pkl:"type"` // "file"|"dir"
	Size *int64 `pkl:"size"`
}

type DiffEntry struct {
	Path       string `pkl:"path"`
	ChangeType string `pkl:"changeType"` // "added"|"removed"|"modified"
}

type LogExcerpt struct {
	Source  string `pkl:"source"`
	Content string `pkl:"content"`
}

// CapabilityFact mirrors diagnostic.Diagnostic (capability-spike/diagnostic).
type CapabilityFact struct {
	FactID   string `pkl:"factId"`
	Severity string `pkl:"severity"`
	Code     string `pkl:"code"`
	Vault    string `pkl:"vault"`
	Message  string `pkl:"message"`
}

// CapabilityGrant mirrors supervisor.Grant (capability-spike/supervisor).
type CapabilityGrant struct {
	FactID   string `pkl:"factId"`
	Vault    string `pkl:"vault"`
	Approved bool   `pkl:"approved"`
}

// CapabilityObservation mirrors runtime.Observation (capability-spike/runtime).
type CapabilityObservation struct {
	FactID     string `pkl:"factId"`
	Vault      string `pkl:"vault"`
	Reason     string `pkl:"reason"`
	Operation  string `pkl:"operation"`
	RecordedAt string `pkl:"recordedAt"`
}

// ReconciliationFlag mirrors reconcile.Flag (capability-spike/reconcile).
type ReconciliationFlag struct {
	Kind   FlagKind `pkl:"kind"`
	FactID string   `pkl:"factId"`
	Detail string   `pkl:"detail"`
}

type ValidationResult struct {
	SchemaVersion      string            `pkl:"schemaVersion"`
	ArtifactHashes     map[string]string `pkl:"artifactHashes"`
	StructurallyValid  bool              `pkl:"structurallyValid"`
	ValidationErrors   []string          `pkl:"validationErrors"`
}

type Package struct {
	SchemaVersion string      `pkl:"schemaVersion"`
	Execution     ExecutionIdentity `pkl:"execution"`
	Scenario      ScenarioResult    `pkl:"scenario"`
	Snapshots     []SnapshotRef     `pkl:"snapshots"`
	FileTree      []FileTreeEntry   `pkl:"fileTree"`
	Diff          []DiffEntry       `pkl:"diff"`
	Logs          []LogExcerpt      `pkl:"logs"`

	CapabilityFacts        []CapabilityFact        `pkl:"capabilityFacts"`
	CapabilityGrants       []CapabilityGrant       `pkl:"capabilityGrants"`
	CapabilityObservations []CapabilityObservation `pkl:"capabilityObservations"`
	ReconciliationFlags    []ReconciliationFlag    `pkl:"reconciliationFlags"`

	Validation ValidationResult `pkl:"validation"`
}

// SchemaVersion is the current Evidence.pkl contract version. Bump it
// whenever Evidence.pkl's shape changes in a way consumers must react to.
const SchemaVersion = "1.0.0"
