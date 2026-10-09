package main

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
)

// CveResticStates reruns the installed S1 and S2 checkers against the scenario's
// pinned inputs. No bytes are supplied by the snapshot model being verified.
func (m *AgentPlugins) CveResticStates(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "**/.worktrees", ".git"]
	source *dagger.Directory,
	// Unique invocation token so checker execution is not reused from cache.
	runId string,
) (*dagger.Directory, error) {
	states := dag.Directory()
	for _, state := range []string{"S1", "S2"} {
		installed, err := m.CveCheckerReplayImage(ctx, source, state)
		if err != nil {
			return nil, err
		}
		run := installed.
			WithDirectory("/case", source.Directory("test/_global/cve-2026-66066-forensics/checker-inputs")).
			WithEnvVariable("CIT367_RUN", runId).
			WithExec([]string{"cve-checker-capture", "/case", "/report"})
		states = states.WithDirectory(state, run.Directory("/report"))
	}
	return states, nil
}
