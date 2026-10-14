package main

// CIT-404: render committed evidence and replay it through the installed
// rails-cases ontology and scenario-owned browser tests. Only global scenarios ask Jev.

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"fmt"
	"strings"
)

const (
	// Node and the system libraries Chromium needs.
	railsClaimsImage = "mcr.microsoft.com/playwright:v1.59.1-noble"
	// Frame.pkl and the Jev contract it imports are evaluated with this one.
	// The global run pins payloads with the jev feature's pkl; the recordings
	// fact in Replay.test.pkl fails if the two disagree on a digest.
	railsClaimsPklVersion = "0.32.1"
	// Where the rails-cases and jev features install their Pkl modules.
	railsCasesHome = "/usr/local/share/rails-cases"
	// Reviewed evidence lives beside the local scenarios in test/rails-cases/<case>.
	railsCaseFixtures = "/workspace/test/rails-cases/"
	// Storybook imports generated frame.json files from this application directory.
	// It is an application build output, not the installed feature or evidence store.
	railsClaimsDir = "/workspace/tutorial-app/src/lesson-farms/rails-claims"
)

// tutorial-app with its dependencies, pkl, and Chromium, on the
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
		WithDirectory("/workspace/tutorial-app", app, dagger.ContainerWithDirectoryOpts{Exclude: []string{"node_modules"}}).
		// Storybook's startup regenerates the replay fixtures, which read these.
		WithDirectory("/workspace/src/jev/pkl", source.Directory("src/jev/pkl")).
		WithDirectory("/workspace/src/cve-2026-66066", source.Directory("src/cve-2026-66066")).
		WithDirectory("/workspace/jev-playwright", source.Directory("jev-playwright"), dagger.ContainerWithDirectoryOpts{Include: []string{"package.json", "*.mjs", "*.ts", "*.pcf", "pkl/**", "fixtures/**"}}).
		// The Pkl modules where the features install them, and the fixtures.
		WithFile("/usr/local/share/jev/pkl/Jev.pkl", source.File("src/jev/pkl/Jev.pkl")).
		WithDirectory(railsCasesHome, source.Directory("src/rails-cases"), dagger.ContainerWithDirectoryOpts{Include: []string{"*.pkl"}}).
		WithDirectory(railsCaseFixtures, source.Directory("test/rails-cases"), dagger.ContainerWithDirectoryOpts{Exclude: []string{"*/replay.har", "*/*.js", "*/*.css", "*/*.html", "*/*.ttf"}}).
		WithEnvVariable("RAILS_CASES_HOME", railsCasesHome).
		WithEnvVariable("RAILS_CASE_FIXTURES", railsCaseFixtures), nil
}

// CIT-401: a case replayed with the rails-cases feature. The frame is
// rendered as above; Storybook is built and served statically, and the
// scenario's replay.sh steps through the one story, recording what it loaded
// into /replay/replay.har. The feature's scenario replays from that HAR.
func railsCase(ctx context.Context, source *dagger.Directory, hash, story, word, phrase string) (*dagger.Container, error) {
	app, err := railsClaimsApp(ctx, source)
	if err != nil {
		return nil, err
	}
	storybook := app.WithWorkdir(railsCasesHome).
		WithExec([]string{"pkl", "test", "-p", "hash=" + hash, "-p", "case=" + railsCaseFixtures + story, railsCaseFixtures + "Recordings.test.pkl"}).
		WithExec([]string{"pkl", "eval", "-f", "json", "-p", "hash=" + hash, "-p", "case=" + railsCaseFixtures + story, "-o", railsClaimsDir + "/cases/" + hash + "/frame.json", "Frame.pkl"}).
		WithWorkdir("/workspace/tutorial-app").
		WithExec([]string{"npx", "storybook", "build", "-o", "/storybook"}).
		WithExposedPort(6006).
		AsService(dagger.ContainerAsServiceOpts{Args: []string{"npx", "--yes", "http-server@14.1.1", "/storybook", "-p", "6006", "-s"}})
	return dag.Container().From(railsClaimsImage).
		WithDirectory("/tmp/rails-cases", source.Directory("src/rails-cases")).
		WithWorkdir("/tmp/rails-cases").
		WithExec([]string{"./install.sh"}).
		WithFile("/usr/local/bin/pkl", app.File("/usr/local/bin/pkl")).
		WithFile("/usr/local/share/jev/pkl/Jev.pkl", source.File("src/jev/pkl/Jev.pkl")).
		WithDirectory("/tests", source.Directory("test/rails-cases")).
		WithWorkdir("/tests").
		WithExec([]string{"npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"}).
		WithDirectory("/replay", source.Directory("test/rails-cases/"+story)).
		WithEnvVariable("RAILS_CASES_HOME", railsCasesHome).
		WithServiceBinding("storybook", storybook).
		WithEnvVariable("STORYBOOK_URL", "http://storybook:6006").
		WithWorkdir("/replay").
		WithExec([]string{"/tests/replay.sh", "replay.har", story, word, phrase}).
		WithExec([]string{"pkl", "test", "-p", "hash=" + hash, "-p", "case=/replay", "-p", "word=" + word, "/tests/Replay.test.pkl"}), nil
}

// SecurerandomAlwaysTwo, the control: rails dbafc460fa, same author, day and
// argument, "because it is always 2", never reverted. Story
// securerandom-always-two.
// +check
func (m *AgentPlugins) SecurerandomAlwaysTwo(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git", "**/replay.trace"]
	source *dagger.Directory,
) error {
	c, err := railsCase(ctx, source, "dbafc460fa", "securerandom-always-two", "always", "always 2")
	if err != nil {
		return err
	}
	_, err = c.Sync(ctx)
	return err
}

// SecurerandomAlwaysTwoHar is what the SecurerandomAlwaysTwo replay loaded,
// for the rails-cases scenario to replay from.
func (m *AgentPlugins) SecurerandomAlwaysTwoHar(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git", "**/replay.trace"]
	source *dagger.Directory,
) (*dagger.Directory, error) {
	c, err := railsCase(ctx, source, "dbafc460fa", "securerandom-always-two", "always", "always 2")
	if err != nil {
		return nil, err
	}
	return c.Directory("/replay"), nil
}

// YjitAlwaysAvailable replays the yjit case through the same installed feature.
// +check
func (m *AgentPlugins) YjitAlwaysAvailable(ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git"]
	source *dagger.Directory,
) error {
	c, err := railsCase(ctx, source, "fddf74bea9", "yjit-always-available", "always", "always available")
	if err != nil {
		return err
	}
	_, err = c.Sync(ctx)
	return err
}

// YjitAlwaysAvailableHar exports the keyless replay for the feature scenario.
func (m *AgentPlugins) YjitAlwaysAvailableHar(ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git"]
	source *dagger.Directory,
) (*dagger.Directory, error) {
	c, err := railsCase(ctx, source, "fddf74bea9", "yjit-always-available", "always", "always available")
	if err != nil {
		return nil, err
	}
	return c.Directory("/replay"), nil
}
