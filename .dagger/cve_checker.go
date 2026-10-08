package main

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"encoding/json"
	"fmt"
)

// CveChecker installs both historical checker states into disposable instances of the
// existing forensics scenario's checker target. Export the returned directory
// to retain each run's inputs/output and the combined shared investigation.
func (m *AgentPlugins) CveChecker(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "**/.worktrees", ".git"]
	source *dagger.Directory,
) (*dagger.Directory, error) {
	feature := source.Directory("src/cve-2026-66066")
	raw, err := feature.File("deliveries.json").Contents(ctx)
	if err != nil { return nil, err }
	var deliveries []map[string]string
	if err := json.Unmarshal([]byte(raw), &deliveries); err != nil { return nil, err }
	if len(deliveries) != 2 { return nil, fmt.Errorf("this slice requires two checker states") }
	meta, err := feature.File("devcontainer-feature.json").Contents(ctx)
	if err != nil { return nil, err }
	var metadata map[string]interface{}
	if err := json.Unmarshal([]byte(meta), &metadata); err != nil { return nil, err }
	base := source.Directory("test/_global/cve-2026-66066-forensics").DockerBuild(dagger.DirectoryDockerBuildOpts{Target: "checker"})
	reports := dag.Directory()
	states := []string{}
	var last *dagger.Container
	for _, delivery := range deliveries {
		state := delivery["state"]
		states = append(states, state)
		metadata["version"] = delivery["packageVersion"]
		deliveryJSON, err := json.MarshalIndent(delivery, "", "  ")
		if err != nil { return nil, err }
		metadataJSON, err := json.MarshalIndent(metadata, "", "  ")
		if err != nil { return nil, err }
		pkg := feature.WithNewFile("delivery.json", string(deliveryJSON)).WithNewFile("devcontainer-feature.json", string(metadataJSON))
		last = base.WithDirectory("/feature", pkg).
			WithFile("/test/cve-checker.sh", source.File("test/_global/cve-checker.sh")).
			WithFile("/test/cve-checker-failures.ts", source.File("test/_global/cve-checker-failures.ts")).
			WithExec([]string{"sh", "/feature/install.sh"}).
			WithExec([]string{"bash", "/test/cve-checker.sh", "/report"})
		reports = reports.WithDirectory(state, last.Directory("/report"))
	}
	last = last.WithDirectory("/all", reports).
		WithEnvVariable("PATH", "/usr/local/share/cve-2026-66066/runtime/bin:$PATH", dagger.ContainerWithEnvVariableOpts{Expand: true}).
		WithExec(append([]string{"deno", "run", "--no-check", "--allow-all", "/usr/local/share/cve-2026-66066/src/cve-2026-66066/questions/checker/combine.ts", "/all"}, states...))
	return last.Directory("/all"), nil
}
