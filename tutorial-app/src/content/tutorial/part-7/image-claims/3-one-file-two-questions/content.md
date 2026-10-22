---
type: lesson
title: One file, two questions
editor: false
previews: false
terminal: false
---

# One file, two questions

The same file raises two questions, and each needs a different kind of
evidence.

**What do its bytes claim?** The image check answers this by reading the
bytes, without rendering the file or passing it to an image loader. It applies
the investigation's `CraftedMatFile` header predicates: the text header selects libvips' `matload`, while the version and endian bytes
select matio's MAT 7.3/HDF5 reader. It reports that disagreement whatever the
file is called, even `canary.mat`. A second, weaker check reports that a file
named `.png` lacks the PNG signature.

**What did Rails do with it?** The image check cannot answer this. It needs
execution evidence: a recorded run of the application. The original
investigation ran the canary and the PNG control with libvips' untrusted
loaders allowed and blocked:

| Input | Untrusted loaders | Retained outcome |
| --- | --- | --- |
| MATLAB canary | Allowed | Variant returned the dummy file's bytes; trace recorded the file open |
| Same MATLAB canary | Blocked | Loader refused; no dummy file open |
| PNG control | Allowed | PNG variant succeeded; no dummy file open |
| Same PNG control | Blocked | PNG variant succeeded; no dummy file open |

Read together, the four runs establish one thing in this configuration: only
the canary, with untrusted loaders allowed, opened the dummy file. Blocking
untrusted loaders stopped it, and blocking did not break the ordinary PNG.
That is why the control is to block untrusted loaders. Another opinion about
file type would not settle a disagreement between two downstream readers.

The bytes finding and the Rails outcome are not interchangeable. Running the
image check today does **not** rerun Rails or show that a private file was
read; its finding is a reason to inspect loader policy. The Rails outcomes are
retained observations, with source hashes, configuration identity and syscall
traces, in
[the CIT-294 investigation](https://github.com/null-hype/agent-plugins/tree/main/docs/investigations/CIT-265/cit-294),
where `Reconcile.pkl` and `cit294.test.pkl` check them.
