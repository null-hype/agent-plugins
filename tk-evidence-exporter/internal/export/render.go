package export

import (
	"fmt"
	"strings"

	"dagger/tk-evidence-exporter/internal/evidence"
)

// pklQuote renders s as a Pkl double-quoted string literal. Only the
// characters that are actually syntactically significant in a Pkl string
// (backslash, double quote, and the common whitespace escapes) are escaped;
// everything else -- including non-ASCII text -- passes through literally,
// since Pkl source files are UTF-8 and Go's %q escape rules for exotic
// runes don't match Pkl's \u{...} syntax.
func pklQuote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\n':
			b.WriteString(`\n`)
		case '\t':
			b.WriteString(`\t`)
		case '\r':
			b.WriteString(`\r`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// renderInstance renders pkg as a Pkl module amending Evidence.pkl's
// EvidencePackage class, so pkl-go's evaluation of it is a real structural
// validation against the schema -- not just Go-side struct construction.
func renderInstance(pkg evidence.Package) string {
	var b strings.Builder
	b.WriteString("module tkEvidenceRun\n")
	b.WriteString("import \"Evidence.pkl\"\n\n")
	b.WriteString("result: Evidence.EvidencePackage = new Evidence.EvidencePackage {\n")
	fmt.Fprintf(&b, "  schemaVersion = %s\n", pklQuote(pkg.SchemaVersion))
	renderExecution(&b, pkg.Execution)
	renderScenario(&b, pkg.Scenario)
	renderSnapshots(&b, pkg.Snapshots)
	renderFileTree(&b, pkg.FileTree)
	renderDiff(&b, pkg.Diff)
	renderLogs(&b, pkg.Logs)
	renderCapabilityFacts(&b, pkg.CapabilityFacts)
	renderCapabilityGrants(&b, pkg.CapabilityGrants)
	renderCapabilityObservations(&b, pkg.CapabilityObservations)
	renderReconciliationFlags(&b, pkg.ReconciliationFlags)
	renderValidation(&b, pkg.Validation)
	b.WriteString("}\n")
	return b.String()
}

func renderExecution(b *strings.Builder, e evidence.ExecutionIdentity) {
	b.WriteString("  execution {\n")
	fmt.Fprintf(b, "    sourceRevision = %s\n", pklQuote(e.SourceRevision))
	fmt.Fprintf(b, "    workflowRunId = %s\n", pklQuote(e.WorkflowRunID))
	fmt.Fprintf(b, "    workflowRunAttempt = %s\n", pklQuote(e.WorkflowRunAttempt))
	fmt.Fprintf(b, "    runUrl = %s\n", pklQuote(e.RunURL))
	fmt.Fprintf(b, "    jobName = %s\n", pklQuote(e.JobName))
	b.WriteString("    stepRefs {\n")
	for _, s := range e.StepRefs {
		fmt.Fprintf(b, "      %s\n", pklQuote(s))
	}
	b.WriteString("    }\n")
	fmt.Fprintf(b, "    scenarioName = %s\n", pklQuote(e.ScenarioName))
	if e.SnapshotID != nil {
		fmt.Fprintf(b, "    snapshotId = %s\n", pklQuote(*e.SnapshotID))
	}
	b.WriteString("  }\n")
}

func renderScenario(b *strings.Builder, s evidence.ScenarioResult) {
	b.WriteString("  scenario {\n")
	fmt.Fprintf(b, "    scenarioName = %s\n", pklQuote(s.ScenarioName))
	fmt.Fprintf(b, "    outcome = %s\n", pklQuote(string(s.Outcome)))
	b.WriteString("    checks {\n")
	for _, c := range s.Checks {
		b.WriteString("      new {\n")
		fmt.Fprintf(b, "        label = %s\n", pklQuote(c.Label))
		fmt.Fprintf(b, "        outcome = %s\n", pklQuote(string(c.Outcome)))
		if c.Detail != nil {
			fmt.Fprintf(b, "        detail = %s\n", pklQuote(*c.Detail))
		}
		b.WriteString("      }\n")
	}
	b.WriteString("    }\n")
	b.WriteString("  }\n")
}

func renderSnapshots(b *strings.Builder, snapshots []evidence.SnapshotRef) {
	b.WriteString("  snapshots {\n")
	for _, s := range snapshots {
		b.WriteString("    new {\n")
		fmt.Fprintf(b, "      id = %s\n", pklQuote(s.ID))
		fmt.Fprintf(b, "      shortId = %s\n", pklQuote(s.ShortID))
		fmt.Fprintf(b, "      tag = %s\n", pklQuote(s.Tag))
		fmt.Fprintf(b, "      takenAt = %s\n", pklQuote(s.TakenAt))
		b.WriteString("    }\n")
	}
	b.WriteString("  }\n")
}

func renderFileTree(b *strings.Builder, entries []evidence.FileTreeEntry) {
	b.WriteString("  fileTree {\n")
	for _, e := range entries {
		b.WriteString("    new {\n")
		fmt.Fprintf(b, "      path = %s\n", pklQuote(e.Path))
		fmt.Fprintf(b, "      type = %s\n", pklQuote(e.Type))
		if e.Size != nil {
			fmt.Fprintf(b, "      size = %d\n", *e.Size)
		}
		fmt.Fprintf(b, "      snapshotId = %s\n", pklQuote(e.SnapshotID))
		b.WriteString("    }\n")
	}
	b.WriteString("  }\n")
}

func renderDiff(b *strings.Builder, entries []evidence.DiffEntry) {
	b.WriteString("  diff {\n")
	for _, e := range entries {
		b.WriteString("    new {\n")
		fmt.Fprintf(b, "      path = %s\n", pklQuote(e.Path))
		fmt.Fprintf(b, "      changeType = %s\n", pklQuote(e.ChangeType))
		fmt.Fprintf(b, "      fromSnapshotId = %s\n", pklQuote(e.FromSnapshotID))
		fmt.Fprintf(b, "      toSnapshotId = %s\n", pklQuote(e.ToSnapshotID))
		b.WriteString("    }\n")
	}
	b.WriteString("  }\n")
}

func renderLogs(b *strings.Builder, logs []evidence.LogExcerpt) {
	b.WriteString("  logs {\n")
	for _, l := range logs {
		b.WriteString("    new {\n")
		fmt.Fprintf(b, "      source = %s\n", pklQuote(l.Source))
		fmt.Fprintf(b, "      content = %s\n", pklQuote(l.Content))
		b.WriteString("    }\n")
	}
	b.WriteString("  }\n")
}

func renderCapabilityFacts(b *strings.Builder, facts []evidence.CapabilityFact) {
	b.WriteString("  capabilityFacts {\n")
	for _, f := range facts {
		b.WriteString("    new {\n")
		fmt.Fprintf(b, "      factId = %s\n", pklQuote(f.FactID))
		fmt.Fprintf(b, "      severity = %s\n", pklQuote(f.Severity))
		fmt.Fprintf(b, "      code = %s\n", pklQuote(f.Code))
		fmt.Fprintf(b, "      vault = %s\n", pklQuote(f.Vault))
		fmt.Fprintf(b, "      message = %s\n", pklQuote(f.Message))
		b.WriteString("    }\n")
	}
	b.WriteString("  }\n")
}

func renderCapabilityGrants(b *strings.Builder, grants []evidence.CapabilityGrant) {
	b.WriteString("  capabilityGrants {\n")
	for _, g := range grants {
		b.WriteString("    new {\n")
		fmt.Fprintf(b, "      factId = %s\n", pklQuote(g.FactID))
		fmt.Fprintf(b, "      vault = %s\n", pklQuote(g.Vault))
		fmt.Fprintf(b, "      approved = %v\n", g.Approved)
		b.WriteString("    }\n")
	}
	b.WriteString("  }\n")
}

func renderCapabilityObservations(b *strings.Builder, obs []evidence.CapabilityObservation) {
	b.WriteString("  capabilityObservations {\n")
	for _, o := range obs {
		b.WriteString("    new {\n")
		fmt.Fprintf(b, "      factId = %s\n", pklQuote(o.FactID))
		fmt.Fprintf(b, "      vault = %s\n", pklQuote(o.Vault))
		fmt.Fprintf(b, "      reason = %s\n", pklQuote(o.Reason))
		fmt.Fprintf(b, "      operation = %s\n", pklQuote(o.Operation))
		fmt.Fprintf(b, "      recordedAt = %s\n", pklQuote(o.RecordedAt))
		b.WriteString("    }\n")
	}
	b.WriteString("  }\n")
}

func renderReconciliationFlags(b *strings.Builder, flags []evidence.ReconciliationFlag) {
	b.WriteString("  reconciliationFlags {\n")
	for _, f := range flags {
		b.WriteString("    new {\n")
		fmt.Fprintf(b, "      kind = %s\n", pklQuote(string(f.Kind)))
		fmt.Fprintf(b, "      factId = %s\n", pklQuote(f.FactID))
		fmt.Fprintf(b, "      detail = %s\n", pklQuote(f.Detail))
		b.WriteString("    }\n")
	}
	b.WriteString("  }\n")
}

// renderCapabilityTraceInstance renders trace as a Pkl module amending
// Evidence.pkl's CapabilityTrace class -- the same generate-then-evaluate
// pattern renderInstance uses for EvidencePackage, applied to the sibling
// CapabilityTrace root type (CIT-147 slice 2).
func renderCapabilityTraceInstance(trace evidence.CapabilityTrace) string {
	var b strings.Builder
	b.WriteString("module tkCapabilityTraceRun\n")
	b.WriteString("import \"Evidence.pkl\"\n\n")
	b.WriteString("result: Evidence.CapabilityTrace = new Evidence.CapabilityTrace {\n")
	fmt.Fprintf(&b, "  traceId = %s\n", pklQuote(trace.TraceID))
	fmt.Fprintf(&b, "  scenario = %s\n", pklQuote(trace.Scenario))
	fmt.Fprintf(&b, "  source = %s\n", pklQuote(trace.Source))
	fmt.Fprintf(&b, "  sourceRef = %s\n", pklQuote(trace.SourceRef))
	b.WriteString("  checks {\n")
	for _, c := range trace.Checks {
		renderCheck(&b, c)
	}
	b.WriteString("  }\n")
	b.WriteString("  transitions {\n")
	for _, tr := range trace.Transitions {
		renderTransition(&b, tr)
	}
	b.WriteString("  }\n")
	b.WriteString("}\n")
	return b.String()
}

func renderCheck(b *strings.Builder, c evidence.Check) {
	b.WriteString("    new {\n")
	fmt.Fprintf(b, "      id = %s\n", pklQuote(c.ID))
	fmt.Fprintf(b, "      requirement = %s\n", pklQuote(c.Requirement))
	fmt.Fprintf(b, "      constraint = %s\n", pklQuote(c.Constraint))
	fmt.Fprintf(b, "      source = %s\n", pklQuote(c.Source))
	fmt.Fprintf(b, "      sourceRef = %s\n", pklQuote(c.SourceRef))
	b.WriteString("    }\n")
}

func renderTransition(b *strings.Builder, tr evidence.Transition) {
	b.WriteString("    new {\n")
	fmt.Fprintf(b, "      index = %d\n", tr.Index)
	fmt.Fprintf(b, "      kind = %s\n", pklQuote(tr.Kind))
	fmt.Fprintf(b, "      label = %s\n", pklQuote(tr.Label))
	if tr.FactID != nil {
		fmt.Fprintf(b, "      factId = %s\n", pklQuote(*tr.FactID))
	}
	if tr.Vault != nil {
		fmt.Fprintf(b, "      vault = %s\n", pklQuote(*tr.Vault))
	}
	if tr.GoverningRule != nil {
		fmt.Fprintf(b, "      governingRule = %s\n", pklQuote(*tr.GoverningRule))
	}
	if tr.Fact != nil {
		b.WriteString("      fact {\n")
		fmt.Fprintf(b, "        factId = %s\n", pklQuote(tr.Fact.FactID))
		fmt.Fprintf(b, "        severity = %s\n", pklQuote(tr.Fact.Severity))
		fmt.Fprintf(b, "        code = %s\n", pklQuote(tr.Fact.Code))
		fmt.Fprintf(b, "        vault = %s\n", pklQuote(tr.Fact.Vault))
		fmt.Fprintf(b, "        message = %s\n", pklQuote(tr.Fact.Message))
		b.WriteString("      }\n")
	}
	if tr.Grant != nil {
		b.WriteString("      grant {\n")
		fmt.Fprintf(b, "        factId = %s\n", pklQuote(tr.Grant.FactID))
		fmt.Fprintf(b, "        vault = %s\n", pklQuote(tr.Grant.Vault))
		fmt.Fprintf(b, "        approved = %v\n", tr.Grant.Approved)
		b.WriteString("      }\n")
	}
	if tr.Observation != nil {
		b.WriteString("      observation {\n")
		fmt.Fprintf(b, "        factId = %s\n", pklQuote(tr.Observation.FactID))
		fmt.Fprintf(b, "        vault = %s\n", pklQuote(tr.Observation.Vault))
		fmt.Fprintf(b, "        reason = %s\n", pklQuote(tr.Observation.Reason))
		fmt.Fprintf(b, "        operation = %s\n", pklQuote(tr.Observation.Operation))
		fmt.Fprintf(b, "        recordedAt = %s\n", pklQuote(tr.Observation.RecordedAt))
		b.WriteString("      }\n")
	}
	if tr.Flag != nil {
		b.WriteString("      flag {\n")
		fmt.Fprintf(b, "        kind = %s\n", pklQuote(tr.Flag.Kind))
		fmt.Fprintf(b, "        factId = %s\n", pklQuote(tr.Flag.FactID))
		fmt.Fprintf(b, "        detail = %s\n", pklQuote(tr.Flag.Detail))
		b.WriteString("      }\n")
	}
	b.WriteString("    }\n")
}

func renderValidation(b *strings.Builder, v evidence.ValidationResult) {
	b.WriteString("  validation {\n")
	fmt.Fprintf(b, "    schemaVersion = %s\n", pklQuote(v.SchemaVersion))
	b.WriteString("    artifactHashes {\n")
	for _, h := range v.ArtifactHashes {
		b.WriteString("      new {\n")
		fmt.Fprintf(b, "        path = %s\n", pklQuote(h.Path))
		fmt.Fprintf(b, "        sha256 = %s\n", pklQuote(h.SHA256))
		b.WriteString("      }\n")
	}
	b.WriteString("    }\n")
	fmt.Fprintf(b, "    structurallyValid = %v\n", v.StructurallyValid)
	b.WriteString("    validationErrors {\n")
	for _, e := range v.ValidationErrors {
		fmt.Fprintf(b, "      %s\n", pklQuote(e))
	}
	b.WriteString("    }\n")
	b.WriteString("  }\n")
}
