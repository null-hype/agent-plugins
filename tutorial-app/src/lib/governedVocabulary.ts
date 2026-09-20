import type { AdmittedTerm } from './governedVocabulary.pkl';

/**
 * The real, committed `admitted` listing from
 * capability-spike/pkl/GovernedVocabulary.pkl, copied by value the same
 * way grantState.json copies GrantState.pkl's real approved grants -- the
 * browser has no live Pkl evaluator to read the module through, so this is
 * validated instead by reasonResolver.spec.ts staying in agreement with
 * agent-plugins' own resolver_test.go (same phrases, same factIDs, same
 * scopes).
 */
export const admitted: AdmittedTerm[] = [
  {
    phrase: 'planting codeword in a fresh session',
    factId: 'pass-cli:color:resume:plant-codeword',
    scope: 'jin-91-resume-session',
    lossAxes: ['session-lifecycle-detail', 'verb-tense'],
  },
  {
    phrase: 'resuming restored session to read back the codeword',
    factId: 'pass-cli:color:resume:read-codeword',
    scope: 'jin-91-resume-session',
    lossAxes: ['session-lifecycle-detail', 'restoration-provenance'],
  },
];
