# CIT-337: render the retained deleted-trace finding

The S1 and S2 `deleted-trace` finding is generated from the installed checker's captured evaluation record and retained files. Storybook and TutorialKit keep the existing interaction, wording, order, provenance and revision-specific Peek files. Other questions and S3/S4 remain on their existing inputs.

## Retained input and retrieval

`tutorial-app/evidence/cit-337-captures-v1/bundle.json` pins the adjacent archive by SHA-256 and inventories all 157 files. Both are committed, so a clean checkout retrieves the exact inputs without an expiring Actions download. The 81,754-byte archive retains the S1/S2 capture inputs and raw outputs, the combined capture and typed record, installed feature metadata, and six original presentation files under `historical/`. It uses source commit `09f1c11276ffa0f49aca65d719b018f072f2a397`, the head of PR #152 with CIT-336 merged.

These are the installed-checker captures delivered as feature version `20261008.0811`; the generated presentation delivers the CIT-337 milestone `20261008.0813`. Capture provenance names the environment and runtime image actually used. This archive does not claim to be an OCI image or a complete filesystem snapshot. CIT-336's separate retained S2 image/restic artifact provides that layer; this change does not manufacture missing S1 image provenance.

`loadCapturedReplay` verifies archive bytes, every retained file, canonical Pkl record decoding, record-to-answer agreement, source/finding identity, resource digests and the selected mutation's before/after files. It rejects missing or changed inputs. Historical reviewer declarations and missing original mutation outputs remain distinct from the new observations and their assessment; forecasts stay null where absent.

## Generation and checks

With Node 22, Pkl 0.32.1 and `tar` available:

```sh
cd tutorial-app
npm ci
npm run replay:generate
npm test
RAILS_PROBES_NO_SERVERS=1 npx playwright test --config=playwright.questions.config.ts --project 'rails-probes/*' --project rails-probes:lesson --project rails-probes:consistency
npx playwright test --config=playwright.replay.config.ts
npm run build
```

Build, dev, test and Storybook entry points generate the selected presentation before consuming it. Rendering does not run the experiment again. The question acceptance pipeline independently reruns the pinned checkers and compares their selected answers and files with the retained capture, then uses the capture for the selected rendered finding. Existing counterfactual controls still run.

Before removal, generation reproduced the four S1/S2 Storybook fixtures, four lesson traces and six selected reproduction files byte for byte. Those 14 replaceable outputs and 36 lesson copies of the selected evidence are ignored after removal from source control. Generation restores both the lesson introducing a state and the following lessons that carry it forward, preserving the tutorial reporter\'s continuity contract. Historical copies remain retained in the archive.

No UI component or story interaction changes, and no new ontology fields or hand-authored result definitions are introduced. The archive intentionally retains original raw answers beside typed evidence; that redundancy serves replay integrity rather than defining independent expectations.

To recollect evidence, use the versioned feature packager, install each delivery, run `cve-checker-capture` on the pinned scenario inputs, and combine the retained S1/S2 directories with the feature's `combine.ts`, passing an absolute output directory. Preserve the previous bundle as history; a new observation requires a new pinned bundle.
