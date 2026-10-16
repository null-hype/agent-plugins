---
type: lesson
title: One file, two questions
editor: false
previews: false
terminal: false
---

# One file, two questions

**What claims do its bytes make?** The checker implements the existing
`CraftedMatFile` header predicates. The leading text selects libvips' `matload`,
while the version and endian bytes select matio's MAT 7.3/HDF5 reader. It reports
that disagreement even when the filename is `canary.mat`. A second, weaker
check notices that a file named `.png` lacks the PNG signature.

**What happened when Rails processed it?** That requires execution evidence.
The original investigation retained these four outcomes:

| Input | Untrusted loaders | Retained outcome |
| --- | --- | --- |
| MATLAB canary | Allowed | Variant returned the dummy file's bytes; trace recorded the file open |
| Same MATLAB canary | Blocked | Loader refused; no dummy file open |
| PNG control | Allowed | PNG variant succeeded; no dummy file open |
| Same PNG control | Blocked | PNG variant succeeded; no dummy file open |

The observations, source hashes, configuration identity and syscall traces live
in [the CIT-294 investigation](https://github.com/null-hype/agent-plugins/tree/main/docs/investigations/CIT-265/cit-294).
Its `Reconcile.pkl` and `cit294.test.pkl` check those retained observations.
Running today's image checker does **not** rerun Rails or establish that a
private file was read. The header finding is a reason to inspect loader policy.

This is why the control is to block untrusted loaders. Adding another file-type
opinion does not resolve the disagreement between downstream readers.
