## Remaining proof for <issue id="1c73c1a2-e8b4-4670-b7ab-3b0e7f6004e9" href="https://linear.app/citizen6librarian6refrain4/issue/CIT-265/rails-composition-bug-detector-verified-against-cve-history">CIT-265</issue>

<issue id="1c73c1a2-e8b4-4670-b7ab-3b0e7f6004e9" href="https://linear.app/citizen6librarian6refrain4/issue/CIT-265/rails-composition-bug-detector-verified-against-cve-history">CIT-265</issue> has substantial progress: PR <pull-request id="a5c16141-c495-47c8-adcd-4ded793d5cb8" href="https://linear.app/citizen6librarian6refrain4/review/cit-291-pkl-detector-feature-tested-against-noteexpand-scenario-apps-148cb4b739b3">null-hype/agent-plugins#115</pull-request> is merged, including the installed noteexpand detector/Pkl/Jev path, the synthetic TutorialKit report lesson, and the pinned CVE forensics feature. <issue id="1301d21e-4b9b-41be-a07a-73b08b181469" href="https://linear.app/citizen6librarian6refrain4/issue/CIT-278/canary-control-untrusted-loader-with-and-without-blocking">CIT-278</issue> also records a real SVG loader canary and blocking result.

The missing acceptance step is a live **Rails → libvips matload → libmatio/HDF5 → dummy file bytes → returned variant** run. The merged forensics fixture synthesizes the returned PNGs in make_fixture.py and attaches them in seed.rb; it proves recognition/recovery of stored evidence, not that the MATLAB path actually produces those bytes.

## Scope

Reuse the existing <issue id="1301d21e-4b9b-41be-a07a-73b08b181469" href="https://linear.app/citizen6librarian6refrain4/issue/CIT-278/canary-control-untrusted-loader-with-and-without-blocking">CIT-278</issue> environment and observations, PR <pull-request id="7b4199e4-dbf6-4749-8a66-37541a89abed" href="https://linear.app/citizen6librarian6refrain4/review/cit-281-fixture-cleanup-from-the-cit-280-review-886e9a4165a8">null-hype/agent-plugins#110</pull-request> fixtures/runner where appropriate, and the feature/scenario/contract pattern merged in PR <pull-request id="a5c16141-c495-47c8-adcd-4ded793d5cb8" href="https://linear.app/citizen6librarian6refrain4/review/cit-291-pkl-detector-feature-tested-against-noteexpand-scenario-apps-148cb4b739b3">null-hype/agent-plugins#115</pull-request>. The pinned forensics reference documents the MATLAB path in src/cve-2026-66066/vendor/reference/the-attack.md.

Run one pinned Rails/libvips/libmatio/HDF5 configuration against three inputs/arms:

1. **Unblocked MATLAB/HDF5 canary:** a test-owned dummy file is read through the actual Rails representation/variant path, and its bytes are recoverable from the output produced by the real loader.
2. **Blocked MATLAB/HDF5 canary:** the same input/configuration with untrusted loaders blocked refuses the path; retain loader-blocking/refusal evidence and show no dummy-file read/disclosure. A generic crash alone is insufficient.
3. **Ordinary PNG control:** normal image processing continues to work, including under the blocking configuration.

Use the appropriate Rails upload/representation path and record how the declared content type is retained. Do not substitute a direct HDF5 read or a prewritten PNG for the Rails/libvips result.

## Evidence and completion

* Pin and record Rails, Active Storage, ruby-vips, libvips, libmatio/HDF5 versions and loader availability.
* Relate the input, load_defaults/variant_processor configuration, blocking state, actual loader selection, independent file-read observation and returned bytes through the case-owned Pkl records and expectations.
* Retain source revision, reproducible commands, raw observations, actual detector output and authoritative check results. Expected answers stay outside agent/model inputs.
* Demonstrate PASS for unblocked disclosure, blocked refusal/no disclosure, and normal PNG processing, with each verdict bound to its observations.
* Make the real run inspectable from the existing tutorial/report pattern and label recorded versus live execution accurately.
* Keep blind discovery and Jev calibration claims separate from this reproduction. This task requires no paid model call and no Claude credential-workaround changes.

<issue id="1301d21e-4b9b-41be-a07a-73b08b181469" href="https://linear.app/citizen6librarian6refrain4/issue/CIT-278/canary-control-untrusted-loader-with-and-without-blocking">CIT-278</issue> remains the completed SVG canary work; <issue id="bd15e690-9bc0-41d3-89cf-1e63419f1ce5" href="https://linear.app/citizen6librarian6refrain4/issue/CIT-288/experiment-dagger-module-applying-the-method-to-a-case">CIT-288</issue> remains the broader Dagger experiment/orchestration work.

Sources: <pull-request id="a5c16141-c495-47c8-adcd-4ded793d5cb8" href="https://linear.app/citizen6librarian6refrain4/review/cit-291-pkl-detector-feature-tested-against-noteexpand-scenario-apps-148cb4b739b3">null-hype/agent-plugins#115</pull-request>, <pull-request id="7b4199e4-dbf6-4749-8a66-37541a89abed" href="https://linear.app/citizen6librarian6refrain4/review/cit-281-fixture-cleanup-from-the-cit-280-review-886e9a4165a8">null-hype/agent-plugins#110</pull-request>, [synthetic forensics fixture](<https://github.com/null-hype/agent-plugins/blob/e69901f6cec1c61d7e27a4cf6f91fc0f7f7c165a/test/_global/cve-2026-66066-forensics/make_fixture.py>).
