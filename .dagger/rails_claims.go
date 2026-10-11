package main

// CIT-397: one Dagger check per rails-claims case, ending with `pkl test`.
//
// Storybook runs as a service; replay.sh steps through the case's story as a
// user with playwright-cli and keeps the trace; Replay.test.pkl reads the
// keyframes from that trace and checks them against the case's evidence.
// The cases are listed in tutorial-app/src/lesson-farms/rails-claims/cases.pkl.

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	// Node and the system libraries Chromium needs.
	railsClaimsImage = "mcr.microsoft.com/playwright:v1.59.1-noble"
	// Frame.pkl and the Jev contract it imports are evaluated with this one.
	railsClaimsPklVersion = "0.26.3"
	railsClaimsDir        = "/workspace/tutorial-app/src/lesson-farms/rails-claims"
)

// tutorial-app with its dependencies, pkl, and playwright-cli's Chromium, on the
// engine's own platform: Chromium under emulation is too slow to wait for.
func railsClaimsApp(ctx context.Context, source *dagger.Directory) (*dagger.Container, error) {
	platform, err := dag.DefaultPlatform(ctx)
	if err != nil {
		return nil, err
	}
	pklArch := "amd64"
	if strings.HasSuffix(string(platform), "arm64") {
		pklArch = "aarch64"
	}
	app := source.Directory("tutorial-app")
	return dag.Container().From(railsClaimsImage).
		WithFile("/usr/local/bin/pkl",
			dag.HTTP(fmt.Sprintf("https://github.com/apple/pkl/releases/download/%s/pkl-linux-%s", railsClaimsPklVersion, pklArch)),
			dagger.ContainerWithFileOpts{Permissions: 0755}).
		WithWorkdir("/workspace/tutorial-app").
		WithFile("package.json", app.File("package.json")).
		WithFile("package-lock.json", app.File("package-lock.json")).
		WithExec([]string{"npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"}).
		WithExec([]string{"npx", "playwright-cli", "install-browser", "chromium"}).
		WithDirectory("/workspace/tutorial-app", app, dagger.ContainerWithDirectoryOpts{Exclude: []string{"node_modules"}}).
		// Storybook's startup regenerates the replay fixtures, which read these.
		WithDirectory("/workspace/src/jev/pkl", source.Directory("src/jev/pkl")).
		WithDirectory("/workspace/src/cve-2026-66066", source.Directory("src/cve-2026-66066")).
		WithDirectory("/workspace/jev-playwright", source.Directory("jev-playwright"), dagger.ContainerWithDirectoryOpts{Include: []string{"package.json", "*.mjs", "*.ts", "*.pcf", "pkl/**", "fixtures/**"}}), nil
}

// RailsClaim replays one case's story as a user and runs Replay.test.pkl on
// the trace. It fails when a step fails or a fact does not hold.
func (m *AgentPlugins) RailsClaim(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git", "**/replay.trace"]
	source *dagger.Directory,
	// The case, its directory under cases/ (as listed in cases.pkl).
	hash string,
) (string, error) {
	app, err := railsClaimsApp(ctx, source)
	if err != nil {
		return "", err
	}
	storybook := app.WithExposedPort(6006).AsService(dagger.ContainerAsServiceOpts{
		// 0.0.0.0 with no allowedHosts: Storybook accepts the service hostname.
		Args: []string{"npx", "storybook", "dev", "-p", "6006", "--host", "0.0.0.0", "--no-open", "--ci"},
	})
	return app.
		WithServiceBinding("storybook", storybook).
		WithEnvVariable("STORYBOOK_URL", "http://storybook:6006").
		WithWorkdir(railsClaimsDir).
		WithExec([]string{"./replay.sh", hash}).
		WithExec([]string{"pkl", "test", "-p", "hash=" + hash, "Replay.test.pkl"}).
		Stdout(ctx)
}

// CheckRailsClaims: every case in cases.pkl, replayed, shows the user its frame.
// +check
func (m *AgentPlugins) CheckRailsClaims(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git", "**/replay.trace"]
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
	for _, hash := range cases {
		if _, err := m.RailsClaim(ctx, source, hash); err != nil {
			return fmt.Errorf("case %s: %w", hash, err)
		}
	}
	return nil
}
