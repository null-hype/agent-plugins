---
type: lesson
title: Where Proton Drive fits
editor: false
previews: false
terminal: false
---

# Where Proton Drive fits

One round trip through Proton Drive was recorded on 16 October 2026. Three
files, the canary, the Excalidraw export and the local control, were uploaded
with Proton Drive CLI 0.9.0, downloaded again, and hashed on both sides:

| File | SHA-256 before upload and after download |
| --- | --- |
| `rails-canary.png` | `f1c62ebc…` (same) |
| `excalidraw-export.png` | `d62147db…` (same) |
| `control.png` | `704c213a…` (same) |

The image check on the downloaded bytes reported the same two canary findings
and nothing for the other two files. The record, with full hashes and the
checker's output, is in
[`test/protondrive/fixtures/image-claims-20261016T050720Z`](https://github.com/null-hype/agent-plugins/tree/main/test/protondrive/fixtures/image-claims-20261016T050720Z).

That is what encrypted storage should do: the bytes that come out are the bytes
that went in. It also means the canary arrives exactly as dangerous as it left.
Encryption protects the files in transit and at rest; it says nothing about
what the application that opens them will do. That still depends on loader
policy, as the Rails runs showed.

This part did not log in to Proton Drive or transfer anything from your
browser; the round trip above is recorded.

**Next step:** download a folder someone has shared with you, run the image
check on it as in the previous lesson, and read each finding before you choose
which application opens which file. Keep the bytes and the checker's output, so
a later investigation can ask what was checked, with which version, and what
still needs evidence.
