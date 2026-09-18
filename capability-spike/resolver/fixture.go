package resolver

// FixtureReason is the reason string CIT-139's framing calls for: "verbatim,
// not authored." It is the literal PROTON_PASS_AGENT_REASON the generated
// `color` bin emits at src/pass-cli/install.sh:89 during `color resume`,
// with AGENT_ASSIGNMENT substituted for the real value
// test/_global/jin-91-resume-session/Dockerfile's `ARG SCENARIO_NAME`
// pins ("jin-91-resume-session" -- see that Dockerfile's own comment on
// SCENARIO_NAME/RESTIC_TAG/AGENT_ASSIGNMENT all reading the same string).
// fixture_test.go diffs the "scenario: ..." suffix against install.sh's
// own text so this cannot silently drift into an invented string.
const FixtureReason = "jin-91-resume-session scenario: planting codeword in a fresh session"

// FixtureReasonGranted is a second real, verbatim reason from the same
// install.sh (line 126, `color resume`'s second phase) and the same
// scenario's scope -- used alongside FixtureReason to demonstrate that an
// admitted-and-granted phrase resolves clean, in contrast to
// FixtureReason's admitted-but-ungranted CAP_NO_GRANT.
const FixtureReasonGranted = "jin-91-resume-session scenario: resuming restored session to read back the codeword"

// FixtureReasonUnresolved is a third real, verbatim reason from install.sh
// (line 43, the unconditional favorite-color prompt), from a different
// real scenario (test/_global/jin-81-pass-cli's Dockerfile pins
// AGENT_ASSIGNMENT="jin-81-pass-cli"). GovernedVocabulary.pkl deliberately
// never admits this phrase, so it demonstrates CAP_TERM_UNRESOLVED --
// distinct from FixtureReason's CAP_NO_GRANT -- without inventing prose
// that doesn't already exist in the repo.
const FixtureReasonUnresolved = "jin-81-pass-cli scenario: color bin asking claude its favorite color"
