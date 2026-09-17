// Package evidence mirrors tk-evidence-exporter/pkl/Evidence.pkl field for
// field. These are both the values internal/export renders into a generated
// Pkl instance and the shape pkl-go evaluates that instance back into, so a
// drift between this file and Evidence.pkl surfaces as a pkl-go decode error
// rather than silently diverging. Every field also carries an explicit
// `json` tag matching the schema's own camelCase field name -- the exported
// evidence.json is this package's real external contract (what
// ts/evidence.pkl.ts's consumers actually parse), and Go's default
// PascalCase field-name marshaling would silently produce a JSON shape the
// generated TypeScript interfaces don't match.
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
	SourceRevision     string   `pkl:"sourceRevision" json:"sourceRevision"`
	WorkflowRunID      string   `pkl:"workflowRunId" json:"workflowRunId"`
	WorkflowRunAttempt string   `pkl:"workflowRunAttempt" json:"workflowRunAttempt"`
	RunURL             string   `pkl:"runUrl" json:"runUrl"`
	JobName            string   `pkl:"jobName" json:"jobName"`
	StepRefs           []string `pkl:"stepRefs" json:"stepRefs"`
	ScenarioName       string   `pkl:"scenarioName" json:"scenarioName"`
	// The exact restic snapshot ID produced during this run -- see
	// Evidence.pkl's doc comment on this field. nil when this run produced
	// no snapshot.
	SnapshotID *string `pkl:"snapshotId" json:"snapshotId"`
}

type CheckResult struct {
	Label   string  `pkl:"label" json:"label"`
	Outcome Outcome `pkl:"outcome" json:"outcome"`
	Detail  *string `pkl:"detail" json:"detail"`
}

type ScenarioResult struct {
	ScenarioName string        `pkl:"scenarioName" json:"scenarioName"`
	Outcome      Outcome       `pkl:"outcome" json:"outcome"`
	Checks       []CheckResult `pkl:"checks" json:"checks"`
}

type SnapshotRef struct {
	ID      string `pkl:"id" json:"id"`
	ShortID string `pkl:"shortId" json:"shortId"`
	Tag     string `pkl:"tag" json:"tag"`
	TakenAt string `pkl:"takenAt" json:"takenAt"`
}

type FileTreeEntry struct {
	Path string `pkl:"path" json:"path"`
	Type string `pkl:"type" json:"type"` // "file"|"dir"
	Size *int64 `pkl:"size" json:"size"`
	// The snapshot this entry was listed from (`restic ls`'s own "snapshot"
	// header line) -- see Evidence.pkl's doc comment on this field.
	SnapshotID string `pkl:"snapshotId" json:"snapshotId"`
}

type DiffEntry struct {
	Path       string `pkl:"path" json:"path"`
	ChangeType string `pkl:"changeType" json:"changeType"` // "added"|"removed"|"modified"
	// The two snapshots `restic diff` compared (its own trailing
	// "statistics" line) -- see Evidence.pkl's doc comment on these fields.
	FromSnapshotID string `pkl:"fromSnapshotId" json:"fromSnapshotId"`
	ToSnapshotID   string `pkl:"toSnapshotId" json:"toSnapshotId"`
}

type LogExcerpt struct {
	Source  string `pkl:"source" json:"source"`
	Content string `pkl:"content" json:"content"`
}

// CapabilityFact mirrors diagnostic.Diagnostic (capability-spike/diagnostic).
type CapabilityFact struct {
	FactID   string `pkl:"factId" json:"factId"`
	Severity string `pkl:"severity" json:"severity"`
	Code     string `pkl:"code" json:"code"`
	Vault    string `pkl:"vault" json:"vault"`
	Message  string `pkl:"message" json:"message"`
}

// CapabilityGrant mirrors supervisor.Grant (capability-spike/supervisor).
type CapabilityGrant struct {
	FactID   string `pkl:"factId" json:"factId"`
	Vault    string `pkl:"vault" json:"vault"`
	Approved bool   `pkl:"approved" json:"approved"`
}

// CapabilityObservation mirrors runtime.Observation (capability-spike/runtime).
type CapabilityObservation struct {
	FactID     string `pkl:"factId" json:"factId"`
	Vault      string `pkl:"vault" json:"vault"`
	Reason     string `pkl:"reason" json:"reason"`
	Operation  string `pkl:"operation" json:"operation"`
	RecordedAt string `pkl:"recordedAt" json:"recordedAt"`
}

// ReconciliationFlag mirrors reconcile.Flag (capability-spike/reconcile).
type ReconciliationFlag struct {
	Kind   FlagKind `pkl:"kind" json:"kind"`
	FactID string   `pkl:"factId" json:"factId"`
	Detail string   `pkl:"detail" json:"detail"`
}

// ArtifactHash is one input file's content hash -- see Evidence.pkl's doc
// comment on why this is a Listing/slice, not a Pkl Mapping/Go map.
type ArtifactHash struct {
	Path   string `pkl:"path" json:"path"`
	SHA256 string `pkl:"sha256" json:"sha256"`
}

type ValidationResult struct {
	SchemaVersion     string         `pkl:"schemaVersion" json:"schemaVersion"`
	ArtifactHashes    []ArtifactHash `pkl:"artifactHashes" json:"artifactHashes"`
	StructurallyValid bool           `pkl:"structurallyValid" json:"structurallyValid"`
	ValidationErrors  []string       `pkl:"validationErrors" json:"validationErrors"`
}

// TransitionKind mirrors the Pkl typealias of the same name. Go alias for
// the same pkl-go decoding reason as Outcome/FlagKind above.
type TransitionKind = string

const (
	TransitionEvaluation      TransitionKind = "evaluation"
	TransitionPolicyDecision  TransitionKind = "policy-decision"
	TransitionMaterialization TransitionKind = "materialization"
	TransitionReconciliation  TransitionKind = "reconciliation"
)

// Transition mirrors Evidence.pkl's Transition class -- one step in a
// capability-decision sequence. See that class's doc comment for why
// governingRule/the nested fact-or-flag's own message/detail carry real,
// not re-authored, text.
type Transition struct {
	Index         int                    `pkl:"index" json:"index"`
	Kind          TransitionKind         `pkl:"kind" json:"kind"`
	Label         string                 `pkl:"label" json:"label"`
	FactID        *string                `pkl:"factId" json:"factId"`
	Vault         *string                `pkl:"vault" json:"vault"`
	GoverningRule *string                `pkl:"governingRule" json:"governingRule"`
	Fact          *CapabilityFact        `pkl:"fact" json:"fact"`
	Grant         *CapabilityGrant       `pkl:"grant" json:"grant"`
	Observation   *CapabilityObservation `pkl:"observation" json:"observation"`
	Flag          *ReconciliationFlag    `pkl:"flag" json:"flag"`
}

// Check mirrors Evidence.pkl's Check class -- a governing rule a
// supervisor enforces, independent of any single observation of it. See
// that class's doc comment for why Constraint must be verbatim source
// text, not re-authored prose.
type Check struct {
	ID          string `pkl:"id" json:"id"`
	Requirement string `pkl:"requirement" json:"requirement"`
	Constraint  string `pkl:"constraint" json:"constraint"`
	Source      string `pkl:"source" json:"source"`
	SourceRef   string `pkl:"sourceRef" json:"sourceRef"`
}

// CapabilityTrace mirrors Evidence.pkl's CapabilityTrace class -- a
// sequence of Transitions produced by one execution adapter, plus the
// Check(s) a consumer evaluates that recorded state against. A sibling
// top-level type to Package, not nested under it.
type CapabilityTrace struct {
	TraceID     string       `pkl:"traceId" json:"traceId"`
	Scenario    string       `pkl:"scenario" json:"scenario"`
	Source      string       `pkl:"source" json:"source"`
	SourceRef   string       `pkl:"sourceRef" json:"sourceRef"`
	Checks      []Check      `pkl:"checks" json:"checks"`
	Transitions []Transition `pkl:"transitions" json:"transitions"`
}

type Package struct {
	SchemaVersion string            `pkl:"schemaVersion" json:"schemaVersion"`
	Execution     ExecutionIdentity `pkl:"execution" json:"execution"`
	Scenario      ScenarioResult    `pkl:"scenario" json:"scenario"`
	Snapshots     []SnapshotRef     `pkl:"snapshots" json:"snapshots"`
	FileTree      []FileTreeEntry   `pkl:"fileTree" json:"fileTree"`
	Diff          []DiffEntry       `pkl:"diff" json:"diff"`
	Logs          []LogExcerpt      `pkl:"logs" json:"logs"`

	CapabilityFacts        []CapabilityFact        `pkl:"capabilityFacts" json:"capabilityFacts"`
	CapabilityGrants       []CapabilityGrant       `pkl:"capabilityGrants" json:"capabilityGrants"`
	CapabilityObservations []CapabilityObservation `pkl:"capabilityObservations" json:"capabilityObservations"`
	ReconciliationFlags    []ReconciliationFlag    `pkl:"reconciliationFlags" json:"reconciliationFlags"`

	Validation ValidationResult `pkl:"validation" json:"validation"`
}

// Normalize replaces every nil Listing-backed slice field with a non-nil
// empty one. Evidence.pkl declares all of these as Listing<T>, which
// ts/evidence.pkl.ts renders as a non-nullable Array<T> -- but a Go nil
// slice marshals via encoding/json as `null`, not `[]`, which no Array<T>
// consumer expects. This matters most for fields a caller assigns directly
// (e.g. cmd/export's Validation.ValidationErrors, overwritten with a
// possibly-nil warnings slice after Pkl evaluation), not just ones that
// round-trip through Evaluate.
func (p *Package) Normalize() {
	if p.Execution.StepRefs == nil {
		p.Execution.StepRefs = []string{}
	}
	if p.Scenario.Checks == nil {
		p.Scenario.Checks = []CheckResult{}
	}
	if p.Snapshots == nil {
		p.Snapshots = []SnapshotRef{}
	}
	if p.FileTree == nil {
		p.FileTree = []FileTreeEntry{}
	}
	if p.Diff == nil {
		p.Diff = []DiffEntry{}
	}
	if p.Logs == nil {
		p.Logs = []LogExcerpt{}
	}
	if p.CapabilityFacts == nil {
		p.CapabilityFacts = []CapabilityFact{}
	}
	if p.CapabilityGrants == nil {
		p.CapabilityGrants = []CapabilityGrant{}
	}
	if p.CapabilityObservations == nil {
		p.CapabilityObservations = []CapabilityObservation{}
	}
	if p.ReconciliationFlags == nil {
		p.ReconciliationFlags = []ReconciliationFlag{}
	}
	if p.Validation.ArtifactHashes == nil {
		p.Validation.ArtifactHashes = []ArtifactHash{}
	}
	if p.Validation.ValidationErrors == nil {
		p.Validation.ValidationErrors = []string{}
	}
}

// SchemaVersion is the current Evidence.pkl contract version. Bump it
// whenever Evidence.pkl's shape changes in a way consumers must react to.
//
// 1.1.0: added ExecutionIdentity.snapshotId, FileTreeEntry.snapshotId,
// DiffEntry.{from,to}SnapshotId, and replaced ValidationResult.artifactHashes
// (previously a Pkl Mapping/JSON object) with a Listing<ArtifactHash> that
// actually matches the array shape the exported JSON transport produces.
//
// 1.2.0: added Transition/CapabilityTrace (CIT-147 slice 2) -- a sibling
// top-level type to EvidencePackage, not a field on it, so this bump adds a
// new export shape without changing EvidencePackage's own fields.
//
// 1.3.0: added Check and CapabilityTrace.checks -- the axiom a trace's
// transitions are evaluated against, kept separate from the transitions
// themselves so a verdict is always computed by a consumer, never
// replayed as pre-baked data (CIT-147 slice 2 follow-up).
const SchemaVersion = "1.3.0"
