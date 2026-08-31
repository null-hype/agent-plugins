// The devpod Dagger module: builds the gcloud/devpod-CLI image
// RecreateDevpod runs in, and reprovisions/starts the devenv-base GCE
// workspace. Extracted out of agent-plugins' root module (JIN-105 follow-up)
// so agent-plugins/.dagger/main.go can depend on it by git ref instead of
// holding devpod logic itself.
//
// The image-build chain (withAptPackages/withPassCli/withDaggerCli/
// withDocker/withGit/withContainerUse/withGcloud/withDevpod) is duplicated
// from the root module rather than shared, since this module can't depend
// on the module that depends on it. Kept byte-for-byte identical to what
// the root module had.
package main

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"dagger/devpod/internal/dagger"
)

type Devpod struct{}

// ---------------------------------------------------------------------------
// Image build chain (duplicated from agent-plugins' root module -- see the
// package doc comment for why).

func (m *Devpod) base(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	return dag.Container(dagger.ContainerOpts{Platform: platform}).From("debian:bookworm-slim")
}

func withAptPackages(c *dagger.Container, pkgs ...string) *dagger.Container {
	c = c.WithExec([]string{"apt-get", "update"})
	c = c.WithExec(append([]string{"apt-get", "install", "-y", "--no-install-recommends"}, pkgs...))
	return c.WithExec([]string{"sh", "-c", "rm -rf /var/lib/apt/lists/*"})
}

func withPassCli(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "curl", "ca-certificates", "jq").
		WithEnvVariable("PROTON_PASS_CLI_INSTALL_DIR", "/usr/local/bin").
		WithExec([]string{"sh", "-c", "curl -fsSL https://proton.me/download/pass-cli/install.sh | bash"})
}

func withDaggerCli(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://dl.dagger.io/dagger/install.sh | BIN_DIR=/usr/local/bin sh"})
}

func withDocker(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "docker.io")
}

func withGit(c *dagger.Container) *dagger.Container {
	return withAptPackages(c, "git").
		WithExec([]string{"git", "config", "--system", "user.email", "agent@tidelands.dev"}).
		WithExec([]string{"git", "config", "--system", "user.name", "tidelands-agent"}).
		WithExec([]string{"git", "config", "--system", "--add", "safe.directory", "/workspaces/devenv-base-gce"})
}

func withContainerUse(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "curl -fsSL https://raw.githubusercontent.com/dagger/container-use/main/install.sh | bash"}).
		WithExec([]string{"cp", "/root/.local/bin/container-use", "/usr/local/bin/container-use"}).
		WithExec([]string{"cp", "/root/.local/bin/container-use", "/usr/local/bin/cu"})
}

func withGcloud(c *dagger.Container) *dagger.Container {
	c = withAptPackages(c, "apt-transport-https", "gnupg").
		WithExec([]string{"sh", "-c", "curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg"}).
		WithExec([]string{"sh", "-c", `echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list`})
	return withAptPackages(c, "google-cloud-cli")
}

func withDevpod(c *dagger.Container) *dagger.Container {
	return c.WithExec([]string{"sh", "-c", "curl -fsSL \"https://github.com/loft-sh/devpod/releases/latest/download/devpod-linux-$(dpkg --print-architecture)\" -o /usr/local/bin/devpod && chmod +x /usr/local/bin/devpod"})
}

// Image is the gcloud+devpod CLI image RecreateDevpod runs against --
// PassCli/DaggerCli/Docker/Git/ContainerUse layered on first (same chain
// the root module's Gcloud/Devpod functions used), then gcloud and devpod.
func (m *Devpod) Image(
	// +optional
	platform dagger.Platform,
) *dagger.Container {
	base := withGit(withDocker(withDaggerCli(withPassCli(m.base(platform)))))
	return withDevpod(withGcloud(withContainerUse(base)))
}

// ---------------------------------------------------------------------------
// RecreateDevpod: same behavior as before extraction. The sa-key/restic/ssh
// control flow stays in devpod-gce.sh/gce-common.sh (bash) -- genuinely
// stateful, side-effecting orchestration against a live GCE box that isn't
// meaningfully unit-testable without one. See ProviderAddArgs/
// ProviderUpdateArgs/UpArgs below for the one piece of this that *is*
// factored out as typed, checkable Go: the composed gcloud/devpod command
// lines those two scripts build.

// RecreateDevpod runs `.devcontainer/devpod-gce.sh --reset` inside Image,
// reprovisioning the devenv-base GCE workspace. See ManifestPath for the
// fixed credential-manifest path this expects to already be installed.
//
// --reset, not --recreate: `devpod up --recreate` only rebuilds the
// container from whatever devcontainer.json is already checked out on the
// box -- it does NOT re-fetch the git source. --reset re-clones from origin
// so a new commit actually lands (see devpod-gce.sh for the full history).
func (m *Devpod) RecreateDevpod(
	ctx context.Context,
	protonPassToken *dagger.Secret,
) (string, error) {
	return m.Image("linux/amd64").
		WithFile(
			"/app/.devcontainer/devpod-gce.sh",
			dag.CurrentModule().Source().File("scripts/devpod-gce.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/lib/gce-common.sh",
			dag.CurrentModule().Source().File("scripts/devcontainer/lib/gce-common.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithFile(
			ManifestContainerPath,
			dag.CurrentModule().Source().File("scripts/devcontainer/gcloud.env"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithWorkdir("/app").
		WithEnvVariable("PROTON_PASS_KEY_PROVIDER", "fs").
		WithSecretVariable("PROTON_PASS_PERSONAL_ACCESS_TOKEN", protonPassToken).
		WithExec([]string{"bash", ".devcontainer/devpod-gce.sh", "--reset"}).
		Stdout(ctx)
}

// ManifestPath is the fixed, literal path devpod-gce.sh resolves its
// pass:// credential manifest from (relative to its own working directory).
// Not an option: see src/devpod/README.md for why.
const ManifestPath = ".agent/skills/devpod/.env"

// ManifestContainerPath is where RecreateDevpod installs the manifest inside
// Image -- WithWorkdir("/app") above means ManifestPath resolves relative to
// this at runtime.
const ManifestContainerPath = "/app/" + ManifestPath

// ---------------------------------------------------------------------------
// Typed, checkable command-line builders. These mirror the gcloud/devpod
// invocations devpod-gce.sh composes inline in bash -- same flags, same
// order -- as plain Go functions so CheckDevpodComposedCommands (below) can
// assert their output without a real GCE project, credentials, or network.

// ProviderAddArgs is the `devpod provider add gcloud ...` command line
// devpod-gce.sh runs the first time providerName hasn't been added yet.
func ProviderAddArgs(providerName, googleProjectID, zone, inactivityTimeout string) []string {
	return []string{
		"devpod", "provider", "add", "gcloud",
		"--name", providerName,
		"-o", "PROJECT=" + googleProjectID,
		"-o", "ZONE=" + zone,
		"-o", "INACTIVITY_TIMEOUT=" + inactivityTimeout,
		"--use",
	}
}

// ProviderUpdateArgs is the `devpod provider update ...` command line
// devpod-gce.sh runs on every subsequent invocation, so an existing
// provider picks up a changed INACTIVITY_TIMEOUT default without having to
// be deleted and re-added.
func ProviderUpdateArgs(providerName, inactivityTimeout string) []string {
	return []string{
		"devpod", "provider", "update", providerName,
		"-o", "INACTIVITY_TIMEOUT=" + inactivityTimeout,
	}
}

// UpArgs is the `devpod up ...` command line devpod-gce.sh runs to
// provision/start the workspace. extraArgs are the caller's own args
// forwarded verbatim (e.g. `--ide none`, `--recreate`); ideDefault is
// appended ahead of them only when extraArgs doesn't already specify
// `--ide`/`--ide=...` itself (mirrors devpod-gce.sh's IDE_ARGS case block).
func UpArgs(workspaceID, gitSource, providerName string, extraArgs []string) []string {
	args := []string{
		"devpod", "up", workspaceID,
		"--source", gitSource,
		"--provider", providerName,
		"--id", workspaceID,
	}
	if !hasIDEFlag(extraArgs) {
		args = append(args, "--ide", "none")
	}
	return append(args, extraArgs...)
}

func hasIDEFlag(args []string) bool {
	for _, a := range args {
		if a == "--ide" || strings.HasPrefix(a, "--ide=") {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Checks. No real GCP/GitHub/restic credentials involved -- CheckManifestVars
// and CheckComposedCommands are pure Go/text, and CheckManifestAbsent runs
// the real image but deliberately withholds the manifest file.

// CheckManifestAbsent asserts devpod-gce.sh hard-errors, with its documented
// message, when ManifestPath is missing -- rather than silently proceeding
// with no credentials.
// +check
func (m *Devpod) CheckManifestAbsent(ctx context.Context) error {
	ctr := m.Image("linux/amd64").
		WithFile(
			"/app/.devcontainer/devpod-gce.sh",
			dag.CurrentModule().Source().File("scripts/devpod-gce.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o755},
		).
		WithFile(
			"/app/.devcontainer/lib/gce-common.sh",
			dag.CurrentModule().Source().File("scripts/devcontainer/lib/gce-common.sh"),
			dagger.ContainerWithFileOpts{Permissions: 0o644},
		).
		WithWorkdir("/app").
		WithEnvVariable("PROTON_PASS_PERSONAL_ACCESS_TOKEN", "fake-token-for-check-only").
		WithExec([]string{"bash", ".devcontainer/devpod-gce.sh"}, dagger.ContainerWithExecOpts{Expect: dagger.ReturnTypeAny})

	// devpod-gce.sh writes its "manifest not found" message to stderr
	// (>&2), not stdout -- Stdout(ctx) alone came back empty here.
	stdout, err := ctr.Stdout(ctx)
	if err != nil {
		return fmt.Errorf("running devpod-gce.sh without a manifest (stdout): %w", err)
	}
	stderr, err := ctr.Stderr(ctx)
	if err != nil {
		return fmt.Errorf("running devpod-gce.sh without a manifest (stderr): %w", err)
	}
	out := stdout + stderr
	const want = "not found -- the 'devpod' feature must be installed"
	if !strings.Contains(out, want) {
		return fmt.Errorf("devpod-gce.sh without a manifest: expected output to contain %q, got:\n%s", want, out)
	}
	return nil
}

// declaredManifestVars parses ManifestPath's own KEY=value lines (pass://
// values, never secrets) -- the manifest is the source of truth here, not a
// hardcoded list.
func declaredManifestVars(manifest string) []string {
	re := regexp.MustCompile(`(?m)^([A-Z][A-Z0-9_]*)=`)
	var vars []string
	for _, m := range re.FindAllStringSubmatch(manifest, -1) {
		vars = append(vars, m[1])
	}
	sort.Strings(vars)
	return vars
}

// referencedVars finds every mention of each candidate var name across the
// given shell source, restricted to names declaredManifestVars found in the
// manifest -- i.e. "of the vars the manifest declares, which ones do the
// scripts actually use". Also derived by reading, not hardcoded.
//
// A plain word-boundary match, not just $VAR/${VAR}: gce-common.sh's restic
// helpers never interpolate RESTIC_REPOSITORY/RESTIC_PASSWORD in shell --
// the restic CLI itself reads those two natively from its environment, so
// the script only ever *mentions* them, in a comment explaining exactly
// that ("read natively by the restic CLI"). Requiring literal $VAR syntax
// would make this check reject a real, correctly-used credential.
func referencedVars(shellSource string, candidates []string) []string {
	set := map[string]bool{}
	for _, v := range candidates {
		re := regexp.MustCompile(`\b` + regexp.QuoteMeta(v) + `\b`)
		if re.MatchString(shellSource) {
			set[v] = true
		}
	}
	var out []string
	for v := range set {
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}

// CheckManifestVars asserts every var ManifestPath's manifest declares is
// actually referenced by devpod-gce.sh/gce-common.sh -- catching a manifest
// key that's drifted out of sync with what the scripts require, without
// hardcoding the expected key list in Go.
// +check
func (m *Devpod) CheckManifestVars(ctx context.Context) error {
	manifest, err := dag.CurrentModule().Source().File("scripts/devcontainer/gcloud.env").Contents(ctx)
	if err != nil {
		return fmt.Errorf("reading manifest: %w", err)
	}
	devpodGCE, err := dag.CurrentModule().Source().File("scripts/devpod-gce.sh").Contents(ctx)
	if err != nil {
		return fmt.Errorf("reading devpod-gce.sh: %w", err)
	}
	gceCommon, err := dag.CurrentModule().Source().File("scripts/devcontainer/lib/gce-common.sh").Contents(ctx)
	if err != nil {
		return fmt.Errorf("reading gce-common.sh: %w", err)
	}

	declared := declaredManifestVars(manifest)
	if len(declared) == 0 {
		return fmt.Errorf("manifest declared no vars at all -- expected at least one KEY=pass://... line")
	}
	used := referencedVars(devpodGCE+"\n"+gceCommon, declared)

	if !equalStringSlices(declared, used) {
		return fmt.Errorf("manifest declares %v but scripts only reference %v (declared-but-unused: %v)",
			declared, used, diffStringSlices(declared, used))
	}
	return nil
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func diffStringSlices(a, b []string) []string {
	bSet := map[string]bool{}
	for _, v := range b {
		bSet[v] = true
	}
	var diff []string
	for _, v := range a {
		if !bSet[v] {
			diff = append(diff, v)
		}
	}
	return diff
}

// CheckComposedCommands asserts ProviderAddArgs/ProviderUpdateArgs/UpArgs
// produce the same command lines devpod-gce.sh's bash composes inline, for
// representative fake inputs -- no real project/zone/credentials needed.
// +check
func (m *Devpod) CheckComposedCommands(ctx context.Context) error {
	got := ProviderAddArgs("gcloud-gce", "fake-project", "us-central1-a", "90m")
	want := []string{
		"devpod", "provider", "add", "gcloud",
		"--name", "gcloud-gce",
		"-o", "PROJECT=fake-project",
		"-o", "ZONE=us-central1-a",
		"-o", "INACTIVITY_TIMEOUT=90m",
		"--use",
	}
	if !equalStringSlices(got, want) {
		return fmt.Errorf("ProviderAddArgs: got %v, want %v", got, want)
	}

	got = ProviderUpdateArgs("gcloud-gce", "90m")
	want = []string{"devpod", "provider", "update", "gcloud-gce", "-o", "INACTIVITY_TIMEOUT=90m"}
	if !equalStringSlices(got, want) {
		return fmt.Errorf("ProviderUpdateArgs: got %v, want %v", got, want)
	}

	got = UpArgs("devenv-base-gce", "git:https://TOKEN@github.com/null-hype/devenv-base.git@main", "gcloud-gce", nil)
	want = []string{
		"devpod", "up", "devenv-base-gce",
		"--source", "git:https://TOKEN@github.com/null-hype/devenv-base.git@main",
		"--provider", "gcloud-gce",
		"--id", "devenv-base-gce",
		"--ide", "none",
	}
	if !equalStringSlices(got, want) {
		return fmt.Errorf("UpArgs (no extra args): got %v, want %v", got, want)
	}

	got = UpArgs("devenv-base-gce", "git:https://TOKEN@github.com/null-hype/devenv-base.git@main", "gcloud-gce", []string{"--ide", "vscode"})
	want = []string{
		"devpod", "up", "devenv-base-gce",
		"--source", "git:https://TOKEN@github.com/null-hype/devenv-base.git@main",
		"--provider", "gcloud-gce",
		"--id", "devenv-base-gce",
		"--ide", "vscode",
	}
	if !equalStringSlices(got, want) {
		return fmt.Errorf("UpArgs (caller-supplied --ide): got %v, want %v", got, want)
	}

	return nil
}
