# protondrive fixtures

`list-json-restic-snapshots.json` is the real output of the CIT-378 live
round trip (2026-10-09, proton-drive `cli-drive@0.9.0+75612299`, SDK
`js@0.22.2+75612299`):

```bash
proton-drive filesystem list --json \
    /my-files/protondrive-scenario-20261009T202201Z-4de6cd3f/restic-repo/snapshots
```

It lists the repository's one restic snapshot file, named by its full
snapshot ID. Only identifying fields were scrubbed; the shape is as the
CLI printed it:

- every `uid`, `parentUid` and `treeEventScopeId` is replaced by a
  placeholder keeping the `volume~node[~revision]` structure;
- account emails (`keyAuthor`, `nameAuthor`, `ownedBy.email`,
  `activeRevision.contentAuthor`) are `drive-user@example.com`.

Names, timestamps, sizes and the SHA-1 are unchanged.

Copied unchanged from `test/protondrive/fixtures/` on
null-hype/agent-plugins#181 (CIT-378) at `fd35b55`, for the Drive pane's
story (CIT-386). This copy doesn't depend on that branch; when CIT-378 adds
`list-json-run-folder.json` and `list-json-restic-repo.json`, copy them here
the same way.
