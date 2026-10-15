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

## Second live run: folder levels and download (2026-10-09)

Run ID `protondrive-scenario-20261009T220221Z-0b0d2885`, snapshot
`b23bf5a1672f8c132a355b54b17ffd9ca58d717048f38a51c527d595ec378950`, same CLI
version. It is a different run from the listing above, so its names and IDs
don't link to that file.

Listings, scrubbed as above. Each real ID becomes one placeholder named
after its node (`RESTIC_REPO_NODE_ID`, `SNAPSHOTS_NODE_ID`, ...), so
`parentUid` still links each child to its folder across both files:

| Fixture | Command |
| --- | --- |
| `list-json-run-folder.json` | `proton-drive filesystem list --json /my-files/<run-id>` |
| `list-json-restic-repo.json` | `proton-drive filesystem list --json /my-files/<run-id>/restic-repo` |

Folder entries (`type: "folder"`) have no `activeRevision`, `mediaType` or
`totalStorageSize`; they carry `folder: {"isImported": false}` instead.

Download, into an empty local folder:

```bash
proton-drive filesystem download -d merge -f skip /my-files/<run-id>/restic-repo "$DOWNLOAD_DIR"
```

- The folder lands at `$DOWNLOAD_DIR/restic-repo/`; `download-tree.txt` lists every file that arrived.
- The empty `locks/` folder is not recreated locally.
- `-d merge -f skip` means a conflict never prompts. Restic files never change once written, so skipping a local file that already exists is always right.

Opening the downloaded copy from a fresh process (`env -i` with only
`PATH`, `HOME` and `RESTIC_PASSWORD`), restic 0.18.1:

| Fixture | Command |
| --- | --- |
| `restic-snapshots.json` | `restic -r "$DOWNLOAD_DIR/restic-repo" snapshots --json` |
| `restic-ls.ndjson` | `restic -r "$DOWNLOAD_DIR/restic-repo" ls --json <snapshot-id>` |

`restic ls --json` prints one JSON object per line. The first line has
`struct_type: "snapshot"`, and each later line is a `struct_type: "node"`.
These two files are unscrubbed: they hold only the throwaway container's
hostname, the `vscode` user and a temporary path.

## This copy (tutorial-app)

Copied unchanged from `test/protondrive/fixtures/` on
null-hype/agent-plugins#181 (CIT-378): `list-json-restic-snapshots.json` at
`fd35b55` (CIT-386), the second run's files at `7dd79a3` (CIT-388). Nothing
here depends on that branch.

Where each level of the Drive walk in `Investigation.stories.tsx` comes from:

- the run folder and `restic-repo`: `list-json-run-folder.json` and
  `list-json-restic-repo.json`;
- `restic-repo/snapshots`: the second run has no `filesystem list --json`
  of it, so its entries are the file names in `download-tree.txt`, dated by
  `restic-snapshots.json`'s `time` (no Drive size or mtime);
- the snapshot's tree: `restic-ls.ndjson`;
- `hello.txt`'s contents: not captured. `headless-round-trip.sh` writes
  `echo "$RUN_ID" > hello.txt`, and the run ID is the snapshot's tag, so the
  file is the tag plus a newline: 47 bytes, as `restic ls` reports.
