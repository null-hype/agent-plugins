package main

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// agentWorkspace runs the Linear agent and its Cloudflare connector. There is
// only ever one: two connectors on the same tunnel would split the webhooks.
const agentWorkspace = "linear-agent"

var (
	nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	refRE  = regexp.MustCompile(`^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$`)
)

// toolbox holds what the infrastructure tools act on.
type toolbox struct {
	gce  computeAPI
	host hostAPI
	// githubToken lets devpod clone the private repo. passToken is forwarded
	// to the agent workspace's tailscale-up.sh, as the keepalive does.
	githubToken, passToken string
	// tsAuthKey joins the host itself to the tailnet. Empty leaves it off.
	tsAuthKey string
}

type nameIn struct {
	Name string `json:"name" jsonschema:"workspace name: lowercase letters, digits and dashes, e.g. an issue identifier like cit-430"`
}

type upIn struct {
	Name string `json:"name" jsonschema:"workspace name: lowercase letters, digits and dashes, e.g. an issue identifier like cit-430"`
	Ref  string `json:"ref,omitempty" jsonschema:"git branch, tag or commit of agent-plugins to create the workspace from; default main"`
}

type refIn struct {
	Ref string `json:"ref,omitempty" jsonschema:"git branch, tag or commit of agent-plugins to create the workspace from; default main"`
}

type reviewIn struct {
	PR    int    `json:"pr" jsonschema:"pull request number in agent-plugins"`
	Model string `json:"model,omitempty" jsonschema:"Codex model to review with; default the host's configured model"`
}

type prIn struct {
	PR int `json:"pr" jsonschema:"pull request number in agent-plugins"`
}

type tailnet struct {
	State  string   `json:"state"`
	Name   string   `json:"name,omitempty"`
	IPs    []string `json:"ips,omitempty"`
	Online bool     `json:"online"`
}

type hostStatusOut struct {
	Status  string   `json:"status"`
	IP      string   `json:"ip,omitempty"`
	Ready   bool     `json:"ready"`
	Tailnet *tailnet `json:"tailnet,omitempty"`
	Detail  string   `json:"detail,omitempty"`
}

type workspace struct {
	Name       string `json:"name"`
	State      string `json:"state"`
	JobRunning bool   `json:"job_running"`
}

func checkName(name string) error {
	if !nameRE.MatchString(name) {
		return fmt.Errorf("name %q must be lowercase letters, digits and dashes, at most 40 characters", name)
	}
	return nil
}

func checkRef(ref string) (string, error) {
	if ref == "" {
		return "main", nil
	}
	if !refRE.MatchString(ref) {
		return "", fmt.Errorf("ref %q is not a plain branch, tag or commit", ref)
	}
	return ref, nil
}

func text(b []byte) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}
}

func (t *toolbox) hostStatus(ctx context.Context) (hostStatusOut, error) {
	in, err := t.gce.Instance(ctx)
	if err != nil {
		return hostStatusOut{}, err
	}
	out := hostStatusOut{Status: in.Status, IP: in.IP}
	if in.Status != "RUNNING" {
		return out, nil
	}
	var env map[string]string
	if t.tsAuthKey != "" {
		env = map[string]string{"TS_AUTHKEY": t.tsAuthKey}
	}
	b, err := t.host.Run(ctx, env, "ping")
	if err != nil {
		out.Detail = "booting: " + err.Error()
		return out, nil
	}
	var ping struct{ Tailnet *tailnet }
	if err := json.Unmarshal(b, &ping); err != nil {
		return out, fmt.Errorf("host ping: %w", err)
	}
	out.Ready, out.Tailnet = true, ping.Tailnet
	return out, nil
}

func (t *toolbox) list(ctx context.Context) ([]workspace, error) {
	b, err := t.host.Run(ctx, nil, "list")
	if err != nil {
		return nil, err
	}
	var ws []workspace
	if err := json.Unmarshal(b, &ws); err != nil {
		return nil, fmt.Errorf("host list: %w", err)
	}
	return ws, nil
}

// hostStop stops every running workspace, then the VM, so a scheduled
// shutdown is one call. It refuses while a workspace job is in progress.
func (t *toolbox) hostStop(ctx context.Context) (string, error) {
	in, err := t.gce.Instance(ctx)
	if err != nil {
		return "", err
	}
	if in.Status != "RUNNING" {
		return "", fmt.Errorf("the host is %s, not RUNNING", in.Status)
	}
	ws, err := t.list(ctx)
	if err != nil {
		return "", err
	}
	for _, w := range ws {
		if w.JobRunning {
			return "", fmt.Errorf("workspace %s has a job in progress; wait for it (workspace_status) before stopping the host", w.Name)
		}
	}
	stopped := 0
	for _, w := range ws {
		if w.State == "Running" {
			if _, err := t.host.Run(ctx, nil, "stop", w.Name); err != nil {
				return "", err
			}
			stopped++
		}
	}
	if err := t.gce.Stop(ctx); err != nil {
		return "", err
	}
	return fmt.Sprintf("stopped %d workspace(s); the host is stopping", stopped), nil
}

func (t *toolbox) up(ctx context.Context, name, ref string, agent bool) ([]byte, error) {
	env := map[string]string{"GITHUB_TOKEN": t.githubToken}
	flag := "0"
	if agent {
		env["PROTON_PASS_PERSONAL_ACCESS_TOKEN"] = t.passToken
		flag = "1"
	}
	return t.host.Run(ctx, env, "up", name, ref, flag)
}

func (t *toolbox) addTools(s *mcp.Server) {
	s.AddReceivingMiddleware(limitToolCalls)
	mcp.AddTool(s, &mcp.Tool{
		Name:        "host_status",
		Description: "Report the GCE host VM's status and IP, whether it is ready for workspace tools, and its tailnet node. A ready host joins the tailnet (with Tailscale SSH) if it has not yet.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, hostStatusOut, error) {
		out, err := t.hostStatus(ctx)
		return nil, out, err
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "host_start",
		Description: "Start the GCE host VM. Returns at once; call host_status until ready is true (about two minutes) before using workspace tools.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		in, err := t.gce.Instance(ctx)
		if err != nil {
			return nil, nil, err
		}
		if in.Status == "RUNNING" {
			return text([]byte("the host is already RUNNING")), nil, nil
		}
		if err := t.gce.Start(ctx); err != nil {
			return nil, nil, err
		}
		return text([]byte("the host is starting; call host_status until ready is true")), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "host_stop",
		Description: "Stop every running workspace, then stop the GCE host VM. Refuses while a workspace job is in progress.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		msg, err := t.hostStop(ctx)
		if err != nil {
			return nil, nil, err
		}
		return text([]byte(msg)), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "workspace_list",
		Description: "List the DevPod workspaces on the host with their state (Running, Stopped, Busy) and whether a job is in progress.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		ws, err := t.list(ctx)
		if err != nil {
			return nil, nil, err
		}
		b, _ := json.Marshal(ws)
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "workspace_status",
		Description: "Report one workspace's state, its latest job's exit code (null while running), and the end of the job's log.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in nameIn) (*mcp.CallToolResult, any, error) {
		if err := checkName(in.Name); err != nil {
			return nil, nil, err
		}
		b, err := t.host.Run(ctx, nil, "status", in.Name)
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name: "workspace_up",
		Description: "Create a DevPod workspace from the agent-plugins repo, or start it if it exists. " +
			"Returns at once; creation takes several minutes, so poll workspace_status. " +
			"Name it after the issue, e.g. cit-430. Not for the Linear agent's own workspace: use agent_start.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in upIn) (*mcp.CallToolResult, any, error) {
		if err := checkName(in.Name); err != nil {
			return nil, nil, err
		}
		if in.Name == agentWorkspace {
			return nil, nil, fmt.Errorf("%s is the Linear agent's workspace; use agent_start", agentWorkspace)
		}
		ref, err := checkRef(in.Ref)
		if err != nil {
			return nil, nil, err
		}
		b, err := t.up(ctx, in.Name, ref, false)
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name: "agent_start",
		Description: "Create or start the " + agentWorkspace + " workspace and start the Linear agent and its Cloudflare connector in it, " +
			"so issues can be delegated. Returns at once; poll workspace_status with name " + agentWorkspace + " until job_exit is 0.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in refIn) (*mcp.CallToolResult, any, error) {
		ref, err := checkRef(in.Ref)
		if err != nil {
			return nil, nil, err
		}
		b, err := t.up(ctx, agentWorkspace, ref, true)
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name: "codex_review",
		Description: "Review an agent-plugins pull request with Codex on the host, against AGENTS.md, creating a container-use environment on the host for each finding. " +
			"Returns at once; poll codex_review_status until job_exit is set.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in reviewIn) (*mcp.CallToolResult, any, error) {
		if in.Model != "" && !refRE.MatchString(in.Model) {
			return nil, nil, fmt.Errorf("model %q is not a model name", in.Model)
		}
		b, err := t.host.Run(ctx, map[string]string{"GITHUB_TOKEN": t.githubToken}, "review", strconv.Itoa(in.PR), in.Model)
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "codex_review_status",
		Description: "Report a codex_review job: its exit code (null while running), one line per finding with its container-use environment id and title, and the end of its log.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in prIn) (*mcp.CallToolResult, any, error) {
		b, err := t.host.Run(ctx, nil, "review-status", strconv.Itoa(in.PR))
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "workspace_stop",
		Description: "Stop a workspace's container. Its files are kept; workspace_up starts it again.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in nameIn) (*mcp.CallToolResult, any, error) {
		if err := checkName(in.Name); err != nil {
			return nil, nil, err
		}
		b, err := t.host.Run(ctx, nil, "stop", in.Name)
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "workspace_delete",
		Description: "Delete a workspace and its files. Unpushed work in it is lost.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: ptr(true)},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in nameIn) (*mcp.CallToolResult, any, error) {
		if err := checkName(in.Name); err != nil {
			return nil, nil, err
		}
		b, err := t.host.Run(ctx, nil, "delete", in.Name)
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
}

func ptr[T any](v T) *T { return &v }

// toolCallTimeout keeps every tool call inside the 3 minutes the Linear agent
// waits, so a hung host shows up as an error rather than a timeout.
const toolCallTimeout = 150 * time.Second

func limitToolCalls(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		if method == "tools/call" {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, toolCallTimeout)
			defer cancel()
		}
		return next(ctx, method, req)
	}
}
