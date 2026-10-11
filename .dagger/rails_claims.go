package main

// CIT-397: one Dagger check per rails-claims case, ending with `pkl test`.
//
// RailsClaim re-records one case (a Rails commit) from its sources -- git,
// Vale, Frame.pkl, the Storybook story in a browser -- and runs the case's
// facts; tutorial-app/src/lesson-farms/rails-claims/run-case.mjs is the
// pipeline. The cases are listed in that directory's cases.pkl.
//
// The report fails the check only when a step could not run, a re-recorded
// file differs from the committed one, or the browser did not show the frame.
// The sketch's facts failing is a row of the report, not a failure.

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	// Matches tutorial-app's @playwright/test, so its browsers are already in the image.
	railsClaimsImage = "mcr.microsoft.com/playwright:v1.59.1-noble"
	// Frame.pkl and the Jev contract it imports are evaluated with this one.
	railsClaimsPklVersion  = "0.26.3"
	railsClaimsValeVersion = "3.24.0"
	railsClaimsDir         = "/workspace/tutorial-app/src/lesson-farms/rails-claims"
)

// The engine's own platform: Chromium under emulation is too slow to wait for.
func railsClaimsBase(ctx context.Context, source *dagger.Directory) (*dagger.Container, error) {
	platform, err := dag.DefaultPlatform(ctx)
	if err != nil {
		return nil, err
	}
	pklArch, valeArch := "amd64", "64-bit"
	if strings.HasSuffix(string(platform), "arm64") {
		pklArch, valeArch = "aarch64", "arm64"
	}
	vale := fmt.Sprintf("https://github.com/errata-ai/vale/releases/download/v%[1]s/vale_%[1]s_Linux_%[2]s.tar.gz", railsClaimsValeVersion, valeArch)
	app := source.Directory("tutorial-app")
	return dag.Container().From(railsClaimsImage).
		WithFile("/usr/local/bin/pkl",
			dag.HTTP(fmt.Sprintf("https://github.com/apple/pkl/releases/download/%s/pkl-linux-%s", railsClaimsPklVersion, pklArch)),
			dagger.ContainerWithFileOpts{Permissions: 0755}).
		WithMountedFile("/tmp/vale.tar.gz", dag.HTTP(vale)).
		WithExec([]string{"tar", "-xzf", "/tmp/vale.tar.gz", "-C", "/usr/local/bin", "vale"}).
		WithWorkdir("/workspace/tutorial-app").
		WithFile("package.json", app.File("package.json")).
		WithFile("package-lock.json", app.File("package-lock.json")).
		WithExec([]string{"npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"}).
		WithDirectory("/workspace/tutorial-app", app, dagger.ContainerWithDirectoryOpts{Exclude: []string{"node_modules"}}).
		// Frame.pkl imports the Jev contract; Storybook's startup regenerates the
		// replay fixtures, which read the CVE question tree and jev-playwright.
		WithDirectory("/workspace/src/jev/pkl", source.Directory("src/jev/pkl")).
		WithDirectory("/workspace/src/cve-2026-66066", source.Directory("src/cve-2026-66066")).
		WithDirectory("/workspace/jev-playwright", source.Directory("jev-playwright"), dagger.ContainerWithDirectoryOpts{Include: []string{"package.json", "*.mjs", "*.ts", "*.pcf", "pkl/**", "fixtures/**"}}).
		WithEnvVariable("CI", "1"), nil
}

// RailsClaim re-records one case and runs its facts. Export `artifacts` to
// get the re-recorded case (`<first 10 of the sha>/`) and its consistency.json.
func (m *AgentPlugins) RailsClaim(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git"]
	source *dagger.Directory,
	// The case's commit, its full sha as listed in cases.pkl.
	sha string,
) (*InvestigationReport, error) {
	base, err := railsClaimsBase(ctx, source)
	if err != nil {
		return nil, err
	}
	c := base.WithExec([]string{"node", railsClaimsDir + "/run-case.mjs", sha, "/report"})
	return &InvestigationReport{Artifacts: c.Directory("/report")}, nil
}

// CheckRailsClaims: every case in cases.pkl was asked properly.
// +check
func (m *AgentPlugins) CheckRailsClaims(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git"]
	source *dagger.Directory,
) error {
	listed, err := pkl(dag.Container(dagger.ContainerOpts{Platform: "linux/amd64"}).From(nodeImage), railsClaimsPklVersion).
		WithFile("/cases.pkl", source.File("tutorial-app/src/lesson-farms/rails-claims/cases.pkl")).
		WithExec([]string{"pkl", "eval", "-x", "new JsonRenderer {}.renderValue(cases)", "/cases.pkl"}).
		Stdout(ctx)
	if err != nil {
		return err
	}
	var cases []string
	if err := json.Unmarshal([]byte(listed), &cases); err != nil {
		return fmt.Errorf("cases.pkl: %w", err)
	}
	var failed []string
	for _, sha := range cases {
		report, err := m.RailsClaim(ctx, source, sha)
		if err == nil {
			_, err = report.Check(ctx)
		}
		if err != nil {
			failed = append(failed, fmt.Sprintf("case %s: %v", sha, err))
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("%s", strings.Join(failed, "\n"))
	}
	return nil
}
