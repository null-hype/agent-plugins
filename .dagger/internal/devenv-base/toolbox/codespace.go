package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

// codespaceAPI reads, starts, stops and rebuilds the token owner's GitHub
// codespaces (CIT-436).
type codespaceAPI interface {
	Get(ctx context.Context, name string) (codespace, error)
	// Start and Stop return the codespace once GitHub has accepted the
	// request, usually in state Starting or ShuttingDown.
	Start(ctx context.Context, name string) (codespace, error)
	Stop(ctx context.Context, name string) (codespace, error)
	// Rebuild asks a running codespace to rebuild its container.
	Rebuild(ctx context.Context, name string) error
}

// codespace is the part of GitHub's codespace object the tools report.
type codespace struct {
	Name             string `json:"name"`
	DisplayName      string `json:"display_name"`
	State            string `json:"state"`
	DevcontainerPath string `json:"devcontainer_path"`
	Repository       struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
	GitStatus struct {
		Ref string `json:"ref"`
	} `json:"git_status"`
}

// codespaceStates says in plain words what GitHub's codespace states mean.
// States not listed are shown as GitHub names them.
var codespaceStates = map[string]string{
	"Available":    "running",
	"Created":      "starting",
	"Queued":       "starting",
	"Provisioning": "starting",
	"Awaiting":     "starting",
	"Starting":     "starting",
	"ShuttingDown": "stopping",
	"Shutdown":     "stopped",
	"Rebuilding":   "rebuilding its container",
}

func (c codespace) is(word string) bool { return codespaceStates[c.State] == word }

// String names the codespace and what it is built from, e.g.
// "bug-free space broccoli (null-hype/agent-plugins, branch main)".
func (c codespace) String() string {
	name := c.DisplayName
	if name == "" {
		name = c.Name
	}
	return fmt.Sprintf("%s (%s, branch %s)", name, c.Repository.FullName, c.GitStatus.Ref)
}

// stateWords is the state in plain words, with GitHub's name for it when
// that differs, e.g. "stopped (Shutdown)".
func (c codespace) stateWords() string {
	w, ok := codespaceStates[c.State]
	if !ok || strings.EqualFold(w, c.State) {
		return strings.ToLower(c.State)
	}
	return fmt.Sprintf("%s (%s)", w, c.State)
}

// config is the dev container config a rebuild builds from.
func (c codespace) config() string {
	if c.DevcontainerPath == "" {
		return "its default dev container config"
	}
	return c.DevcontainerPath
}

// codespaces calls the GitHub REST API, and gh for the rebuild, which GitHub
// only offers through the codespace's own tunnel. The token needs the
// Codespaces lifecycle admin permission.
type codespaces struct {
	client *http.Client
	url    string // https://api.github.com/user/codespaces
	token  string
	gh     string // path to the gh binary
}

func (c *codespaces) call(ctx context.Context, method, name, action string) (codespace, error) {
	url := c.url + "/" + name
	if action != "" {
		url += "/" + action
	}
	what := strings.TrimSpace("codespace " + action + " " + name)
	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return codespace{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := c.client.Do(req)
	if err != nil {
		return codespace{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return codespace{}, fmt.Errorf("%s: %s: %s", what, resp.Status, strings.TrimSpace(string(body)))
	}
	var v codespace
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return codespace{}, fmt.Errorf("%s: %w", what, err)
	}
	return v, nil
}

func (c *codespaces) Get(ctx context.Context, name string) (codespace, error) {
	return c.call(ctx, http.MethodGet, name, "")
}

func (c *codespaces) Start(ctx context.Context, name string) (codespace, error) {
	return c.call(ctx, http.MethodPost, name, "start")
}

func (c *codespaces) Stop(ctx context.Context, name string) (codespace, error) {
	return c.call(ctx, http.MethodPost, name, "stop")
}

// Rebuild runs gh codespace rebuild. The token goes in gh's environment, not
// its arguments, with a config directory of its own for each call.
func (c *codespaces) Rebuild(ctx context.Context, name string) error {
	dir, err := os.MkdirTemp("", "gh-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	cmd := exec.CommandContext(ctx, c.gh, "codespace", "rebuild", "--codespace", name)
	cmd.Env = []string{
		"GH_TOKEN=" + c.token,
		"GH_CONFIG_DIR=" + dir,
		"HOME=" + dir,
		"GH_PROMPT_DISABLED=1",
		"GH_NO_UPDATE_NOTIFIER=1",
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("gh codespace rebuild %s: %w: %s", name, err, strings.TrimSpace(string(out)))
	}
	return nil
}
