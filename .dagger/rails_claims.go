package main

// CIT-397: one Dagger check per rails-claims case, ending with `pkl test`.
//
// ask.sh sends each claim's pinned payload to Jev (CIT-399) and Frame.pkl
// renders the frame with those recordings. Storybook then runs as a service;
// replay.sh steps through the case's story as a user with playwright-cli and
// keeps the trace; Replay.test.pkl reads the keyframes from that trace and
// checks them against the case's evidence.
// Each case is a check named like its story, e.g. `dagger check
// yjit-always-available` replays story yjit-always-available.

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
	railsClaimsPklVersion = "0.26.3"
	railsClaimsDir        = "/workspace/tutorial-app/src/lesson-farms/rails-claims"
	jevClientImage        = "python:3.12.11-slim-bookworm"
)

// One case's recordings.json: Payloads.pkl writes each claim's pinned payload
// and ask.sh sends it to Jev. The container holds the jev client and the files
// Frame.pkl reads, added by their contents rather than from source: anything
// taken from source is keyed by the whole tree, so editing the story or the
// replay would call Jev again.
func railsClaimsRecordings(ctx context.Context, source *dagger.Directory, hash string, typesafeApiKey *dagger.Secret) (*dagger.File, error) {
	claims := "tutorial-app/src/lesson-farms/rails-claims/"
	read := []string{"src/jev/jev", "src/jev/jev_pkl.py", "src/jev/pkl/Jev.pkl", claims + "Frame.pkl", claims + "Payloads.pkl", claims + "ask.sh"}
	for _, f := range []string{"commit.txt", "vale.json", "recordings.json", "snapshots.json"} {
		read = append(read, claims+"cases/"+hash+"/"+f)
	}
	c := pkl(dag.Container(dagger.ContainerOpts{Platform: "linux/amd64"}).From(jevClientImage), railsClaimsPklVersion).
		WithExec([]string{"python3", "-m", "venv", "/opt/jev"}).
		WithExec([]string{"/opt/jev/bin/pip", "install", "--no-cache-dir", "pkl-python==0.1.19", "requests==2.32.3"}).
		WithNewFile("/usr/local/bin/jev", "#!/bin/sh\nexec /opt/jev/bin/python /workspace/src/jev/jev \"$@\"\n", dagger.ContainerWithNewFileOpts{Permissions: 0755})
	for _, f := range read {
		text, err := source.File(f).Contents(ctx)
		if err != nil {
			return nil, err
		}
		c = c.WithNewFile("/workspace/"+f, text, dagger.ContainerWithNewFileOpts{Permissions: 0755})
	}
	return c.WithWorkdir(railsClaimsDir).
		WithExec([]string{"pkl", "eval", "-m", "/payloads", "-p", "hash=" + hash, "Payloads.pkl"}).
		WithSecretVariable("TYPESAFE_API_KEY", typesafeApiKey).
		WithExec([]string{"./ask.sh", "/payloads"}, dagger.ContainerWithExecOpts{RedirectStdout: "/recordings.json"}).
		File("/recordings.json"), nil
}

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

// railsClaim asks Jev each of one case's claims, replays the case's story as
// a user, following the lens on word from the phrase it flags, and runs
// Replay.test.pkl on the trace. It fails when a step fails or a fact does not
// hold.
func railsClaim(ctx context.Context, source *dagger.Directory, typesafeApiKey *dagger.Secret, hash, story, word, phrase string) error {
	if typesafeApiKey == nil {
		return fmt.Errorf("TYPESAFE_API_KEY is needed: run under pass-cli run --env-file .env")
	}
	app, err := railsClaimsApp(ctx, source)
	if err != nil {
		return err
	}
	recordings, err := railsClaimsRecordings(ctx, source, hash, typesafeApiKey)
	if err != nil {
		return err
	}
	case_ := "cases/" + hash + "/"
	app = app.WithWorkdir(railsClaimsDir).
		WithFile(case_+"recordings.json", recordings).
		WithExec([]string{"pkl", "eval", "-f", "json", "-p", "hash=" + hash, "-o", case_ + "frame.json", "Frame.pkl"})
	storybook := app.WithWorkdir("/workspace/tutorial-app").WithExposedPort(6006).AsService(dagger.ContainerAsServiceOpts{
		// 0.0.0.0 with no allowedHosts: Storybook accepts the service hostname.
		Args: []string{"npx", "storybook", "dev", "-p", "6006", "--host", "0.0.0.0", "--no-open", "--ci"},
	})
	_, err = app.
		WithServiceBinding("storybook", storybook).
		WithEnvVariable("STORYBOOK_URL", "http://storybook:6006").
		WithExec([]string{"./replay.sh", hash, story, word, phrase}).
		WithExec([]string{"pkl", "test", "-p", "hash=" + hash, "-p", "word=" + word, "Replay.test.pkl"}).
		Sync(ctx)
	return err
}

// YjitAlwaysAvailable: rails fddf74bea9, "`RubyVM::YJIT.enable` is always
// available", reverted the next day. Story yjit-always-available.
// +check
func (m *AgentPlugins) YjitAlwaysAvailable(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git", "**/replay.trace"]
	source *dagger.Directory,
	// Defaults to env://TYPESAFE_API_KEY through .env.
	// +optional
	typesafeApiKey *dagger.Secret,
) error {
	return railsClaim(ctx, source, typesafeApiKey, "fddf74bea9", "yjit-always-available", "always", "always available")
}

// CIT-401: a case replayed with the rails-cases feature. Jev is asked and the
// frame rendered as above; Storybook is built and served statically, and the
// feature's replay.sh steps through the one story, recording what it loaded
// into /replay/replay.har. The feature's scenario replays from that HAR.
func railsCase(ctx context.Context, source *dagger.Directory, typesafeApiKey *dagger.Secret, hash, story, word, phrase string) (*dagger.Container, error) {
	if typesafeApiKey == nil {
		return nil, fmt.Errorf("TYPESAFE_API_KEY is needed: run under pass-cli run --env-file .env")
	}
	app, err := railsClaimsApp(ctx, source)
	if err != nil {
		return nil, err
	}
	recordings, err := railsClaimsRecordings(ctx, source, hash, typesafeApiKey)
	if err != nil {
		return nil, err
	}
	case_ := "cases/" + hash + "/"
	storybook := app.WithWorkdir(railsClaimsDir).
		WithFile(case_+"recordings.json", recordings).
		WithExec([]string{"pkl", "eval", "-f", "json", "-p", "hash=" + hash, "-o", case_ + "frame.json", "Frame.pkl"}).
		WithWorkdir("/workspace/tutorial-app").
		WithExec([]string{"npx", "storybook", "build", "-o", "/storybook"}).
		WithExposedPort(6006).
		AsService(dagger.ContainerAsServiceOpts{Args: []string{"npx", "--yes", "http-server@14.1.1", "/storybook", "-p", "6006", "-s"}})
	return dag.Container().From(railsClaimsImage).
		WithDirectory("/tmp/rails-cases", source.Directory("src/rails-cases")).
		WithWorkdir("/tmp/rails-cases").
		WithExec([]string{"./install.sh"}).
		WithEnvVariable("RAILS_CASES_HOME", "/usr/local/share/rails-cases").
		WithServiceBinding("storybook", storybook).
		WithEnvVariable("STORYBOOK_URL", "http://storybook:6006").
		WithWorkdir("/replay").
		WithExec([]string{"/usr/local/share/rails-cases/replay.sh", "replay.har", story, word, phrase}), nil
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
	// Defaults to env://TYPESAFE_API_KEY through .env.
	// +optional
	typesafeApiKey *dagger.Secret,
) error {
	c, err := railsCase(ctx, source, typesafeApiKey, "dbafc460fa", "securerandom-always-two", "always", "always 2")
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
	// Defaults to env://TYPESAFE_API_KEY through .env.
	// +optional
	typesafeApiKey *dagger.Secret,
) (*dagger.Directory, error) {
	c, err := railsCase(ctx, source, typesafeApiKey, "dbafc460fa", "securerandom-always-two", "always", "always 2")
	if err != nil {
		return nil, err
	}
	return c.Directory("/replay"), nil
}
