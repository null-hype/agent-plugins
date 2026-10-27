package main

import "dagger/worlds/internal/dagger"

// The Playwright evidence adapter: what a delivery run leaves in the container
// (witness's run of the plan and of the work, the spec, the feature, the
// failures) becomes the contents of a world.
func playwrightEvidence(delivered *dagger.Container) *dagger.Container {
	return delivered.WithExec([]string{"sh", "-c", `set -e
w=` + worldDir + `; rm -rf $w; mkdir -p $w
cp -r /runs/plan $w/plan-run; cp -r /runs/work $w/work-run; cp -r /feature $w/feature
cp -r delivery/test-results $w/test-results; [ ! -f /failed.txt ] || cp /failed.txt $w/
cp delivery/feature.spec.ts $w/spec.txt
WITNESS_RUN_DIR=/runs/plan node delivery/diagnostics.mjs delivery/feature.spec.ts > $w/plan.json
WITNESS_RUN_DIR=/runs/work node delivery/diagnostics.mjs delivery/feature.spec.ts > $w/work.json`})
}
