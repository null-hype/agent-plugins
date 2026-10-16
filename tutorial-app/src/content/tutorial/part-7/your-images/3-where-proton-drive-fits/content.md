---
type: lesson
title: Where Proton Drive fits
editor: false
previews: false
terminal: false
---

# Where Proton Drive fits

For an encrypted folder, these checks can run locally before upload or after
files are downloaded. The command from the previous lesson accepts those downloaded paths.
Encryption protects a different boundary from the one explored here: the
application processing the downloaded bytes still needs an appropriate loader
policy. The intended workflow is to download, inspect locally, review the
findings, and then decide which application should open the file.

This part demonstrates the local check; it does not perform a Proton Drive
login, download, upload, or automatic sharing decision. Preserving the original
bytes and the checker output lets a later investigation ask what was checked,
with which version, and what still needs evidence—just as the Rails case does.

One live round trip is recorded in
[`test/protondrive/fixtures/image-claims-20261016T050720Z`](https://github.com/null-hype/agent-plugins/tree/main/test/protondrive/fixtures/image-claims-20261016T050720Z):
the three files were uploaded with Proton Drive CLI 0.9.0, downloaded again,
and had identical SHA-256 hashes on both sides. Running the checker on the
downloaded bytes reported the same two canary findings and nothing for the
Excalidraw export or the PNG control.
