// Package resolver implements CIT-149: turning a raw PROTON_PASS_AGENT_REASON
// string into a real diagnostic, by resolving it against
// GovernedVocabulary.pkl and then, only for a resolved phrase, checking the
// result the same way pkl/Ledger.pkl's checkAccess already does. It does not
// decide access itself -- an admitted phrase still has to clear the same
// gate any other fact does.
package resolver

import (
	"context"
	"fmt"
	"regexp"

	"github.com/apple/pkl-go/pkl"

	"dagger/capability-spike/diagnostic"
	"dagger/capability-spike/supervisor"
)

// AdmittedTerm mirrors pkl/GovernedVocabulary.pkl's AdmittedTerm class.
type AdmittedTerm struct {
	Phrase   string   `pkl:"phrase"`
	FactID   string   `pkl:"factId"`
	Scope    string   `pkl:"scope"`
	LossAxes []string `pkl:"lossAxes"`
}

// GovernedVocabulary mirrors pkl/GovernedVocabulary.pkl's module shape.
type GovernedVocabulary struct {
	RequiresVocabularyAdmission bool            `pkl:"requiresVocabularyAdmission"`
	Admitted                    []*AdmittedTerm `pkl:"admitted"`
}

// LoadVocabulary evaluates vocabularyPath (normally pkl/GovernedVocabulary.pkl)
// through a real pkl-go Evaluator -- the same "loads a supervisor-owned Pkl
// module via the Go bindings" leg supervisor.LoadState uses for
// GrantState.pkl, not a hand-parsed copy of the file's text.
func LoadVocabulary(ctx context.Context, vocabularyPath string) (GovernedVocabulary, error) {
	evaluator, err := pkl.NewEvaluator(ctx, pkl.PreconfiguredOptions)
	if err != nil {
		return GovernedVocabulary{}, fmt.Errorf("start pkl evaluator: %w", err)
	}
	defer evaluator.Close()

	var vocab GovernedVocabulary
	if err := evaluator.EvaluateModule(ctx, pkl.FileSource(vocabularyPath), &vocab); err != nil {
		return GovernedVocabulary{}, fmt.Errorf("evaluate %s: %w", vocabularyPath, err)
	}
	return vocab, nil
}

// ResolvedReason is CIT-149's fixed output shape: the raw statement, the
// fact ID it mapped to (if any), what that mapping loses, and -- only when
// resolution or the subsequent capability check failed -- a diagnostic.
// Diagnostic is nil exactly when the reason resolves clean, mirroring
// Ledger.checkAccess's own true/throw split rather than adding a redundant
// boolean next to it.
type ResolvedReason struct {
	Raw            string                 `json:"raw"`
	ResolvedFactID *string                `json:"resolvedFactId"`
	LossAxes       []string               `json:"lossAxes"`
	Diagnostic     *diagnostic.Diagnostic `json:"diagnostic"`
}

// reasonPattern matches the "<scope> scenario: <phrase>" shape the
// generated `color` bin's PROTON_PASS_AGENT_REASON values follow (see
// src/pass-cli/install.sh and fixture.go). A reason that doesn't even have
// this shape can't name an admitted phrase, so it resolves the same way an
// unadmitted phrase does: CAP_TERM_UNRESOLVED, not a crash.
var reasonPattern = regexp.MustCompile(`^(\S+) scenario: (.+)$`)

// Resolve maps raw against vocab, then -- only for a phrase vocab admits --
// checks the resulting (factID, scope) pair against grantsByFactID exactly
// as pkl/Ledger.pkl's checkAccess would. The scope parsed out of raw is
// passed through as the `vault` argument to that check, so a request whose
// scope was dropped or doesn't match what was admitted never resolves
// clean -- it fails the same way a wrong vault does (CAP_NO_GRANT or
// CAP_VAULT_MISMATCH), not silently, and never by falling back to some
// other scope's grant.
func Resolve(raw string, vocab GovernedVocabulary, grantsByFactID map[string]*supervisor.Grant) ResolvedReason {
	m := reasonPattern.FindStringSubmatch(raw)
	if m == nil {
		return ResolvedReason{
			Raw:      raw,
			LossAxes: []string{},
			Diagnostic: &diagnostic.Diagnostic{
				Severity: diagnostic.SeverityError,
				Code:     diagnostic.CodeTermUnresolved,
				Message:  `reason does not match the "<scope> scenario: <phrase>" shape GovernedVocabulary.pkl is governed against`,
			},
		}
	}
	scope, phrase := m[1], m[2]

	var entry *AdmittedTerm
	for _, candidate := range vocab.Admitted {
		if candidate.Phrase == phrase && candidate.Scope == scope {
			entry = candidate
			break
		}
	}
	if entry == nil {
		return ResolvedReason{
			Raw:      raw,
			LossAxes: []string{},
			Diagnostic: &diagnostic.Diagnostic{
				Severity: diagnostic.SeverityError,
				Code:     diagnostic.CodeTermUnresolved,
				Vault:    scope,
				Message:  fmt.Sprintf("no admitted vocabulary entry for %q in scope %q -- request pending supervisor vocabulary admission", phrase, scope),
			},
		}
	}

	factID := entry.FactID
	if d := checkAccess(factID, scope, grantsByFactID); d != nil {
		return ResolvedReason{
			Raw:            raw,
			ResolvedFactID: &factID,
			LossAxes:       entry.LossAxes,
			Diagnostic:     d,
		}
	}

	return ResolvedReason{
		Raw:            raw,
		ResolvedFactID: &factID,
		LossAxes:       entry.LossAxes,
	}
}

// checkAccess is a Go-side mirror of pkl/Ledger.pkl's checkAccess -- same
// three denial codes and messages, kept in sync by hand the same way
// Inventory.pkl's own header documents duplicating Vaults.pkl's classes
// by hand rather than importing across a module boundary this package
// doesn't have. It exists so Resolve can produce a structured
// ResolvedReason (factID populated even when access is later denied)
// instead of driving `pkl test` as a subprocess and losing that
// resolved-but-denied distinction to a thrown error message, the way
// worker.Run already must for a plain pass/fail fact.
func checkAccess(factID, vault string, grantsByFactID map[string]*supervisor.Grant) *diagnostic.Diagnostic {
	grant := grantsByFactID[factID]
	if grant == nil {
		return &diagnostic.Diagnostic{
			Severity: diagnostic.SeverityError,
			Code:     "CAP_NO_GRANT",
			FactID:   factID,
			Vault:    vault,
			Message:  "no grant has been recorded for this fact -- request pending supervisor review",
		}
	}
	if !grant.Approved {
		return &diagnostic.Diagnostic{
			Severity: diagnostic.SeverityError,
			Code:     "CAP_REJECTED",
			FactID:   factID,
			Vault:    vault,
			Message:  "supervisor explicitly rejected this request",
		}
	}
	if grant.Vault != vault {
		return &diagnostic.Diagnostic{
			Severity: diagnostic.SeverityError,
			Code:     "CAP_VAULT_MISMATCH",
			FactID:   factID,
			Vault:    vault,
			Message:  fmt.Sprintf("supervisor approved this fact for vault %s, not %s", grant.Vault, vault),
		}
	}
	return nil
}
