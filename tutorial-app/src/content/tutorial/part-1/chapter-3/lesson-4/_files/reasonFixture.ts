/**
 * Vendored, verbatim, from agent-plugins' capability-spike/resolver/fixture.go
 * -- three real PROTON_PASS_AGENT_REASON strings the generated `color` bin
 * in src/pass-cli/install.sh actually emits, not prose invented to resolve
 * cleanly. agent-plugins' own resolver/fixture_test.go diffs these against
 * install.sh and the relevant test/_global/*Dockerfile's directly; this
 * copy has no equivalent cross-repo check, so keep it byte-for-byte in
 * sync with fixture.go on drift.
 */

/**
 * install.sh:89, `color resume`'s first phase, scope from
 * test/_global/jin-91-resume-session/Dockerfile's
 * `ARG SCENARIO_NAME=jin-91-resume-session`. GovernedVocabulary.pkl admits
 * this phrase but no grant is ever recorded for it -- CAP_NO_GRANT.
 */
export const FIXTURE_REASON = 'jin-91-resume-session scenario: planting codeword in a fresh session';

/**
 * install.sh:126, `color resume`'s second phase, same scope as
 * FIXTURE_REASON. Admitted *and* granted -- resolves clean, for contrast.
 */
export const FIXTURE_REASON_GRANTED =
  'jin-91-resume-session scenario: resuming restored session to read back the codeword';

/**
 * install.sh:43, the unconditional favorite-color prompt, from a
 * different real scenario (test/_global/jin-81-pass-cli's Dockerfile pins
 * `ARG SCENARIO_NAME=jin-81-pass-cli`). GovernedVocabulary.pkl never
 * admits this phrase -- CAP_TERM_UNRESOLVED, distinct from FIXTURE_REASON's
 * CAP_NO_GRANT.
 */
export const FIXTURE_REASON_UNRESOLVED = 'jin-81-pass-cli scenario: color bin asking claude its favorite color';
