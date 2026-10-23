package main

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// agentWorkspace runs the Linear agent and its Cloudflare connector. There is
// only ever one: two connectors on the same tunnel would split the webhooks.
const agentWorkspace = "linear-agent"

var (
	nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	refRE  = regexp.MustCompile(`^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$`)
	// GitHub codespace names, e.g. bug-free-space-broccoli-jgp9vp7q75r2q96j.
	codespaceRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,99}$`)
	// container-use environment ids, e.g. trusty-burro.
	envRE = regexp.MustCompile(`^[a-z]+-[a-z]+$`)
)

// toolbox holds what the infrastructure tools act on.
type toolbox struct {
	gce        computeAPI
	host       hostAPI
	codespaces codespaceAPI
	// githubToken lets devpod clone the private repo. passToken is forwarded
	// to the agent workspace's tailscale-up.sh, as the keepalive does, and
	// logs codex_review's pass-cli in, for the Linear key.
	githubToken, passToken string
	// tsAuthKey joins the host itself to the tailnet. Empty leaves it off.
	tsAuthKey string
}

type nameIn struct {
	Name string `json:"name" jsonschema:"workspace name: lowercase letters, digits and dashes, e.g. an issue identifier like cit-430"`
}

type codespaceIn struct {
	Name string `json:"name" jsonschema:"codespace name as GitHub shows it, e.g. bug-free-space-broccoli-jgp9vp7q75r2q96j"`
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

type shipIn struct {
	Env    string `json:"env" jsonschema:"the Linear agent's container-use environment id, e.g. trusty-burro"`
	Branch string `json:"branch" jsonschema:"the issue's Linear branch name (its gitBranchName); created if it does not exist"`
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
	// Lifecycle is the host's idle clock and lease (host-lifecycle.sh), or
	// absent on a host set up before it. A map, not json.RawMessage: the
	// output schema is inferred from the type, and a RawMessage's is "null
	// or an array of bytes", which rejects the object (CIT-487).
	Lifecycle map[string]any `json:"lifecycle,omitempty"`
	Detail    string         `json:"detail,omitempty"`
}

// activityOut is the host's work in progress: every toolbox job, not only
// those named after a workspace, and the Linear agent working an issue.
type activityOut struct {
	Jobs         []string       `json:"jobs"`
	AgentRunning bool           `json:"agent_running"`
	Lifecycle    map[string]any `json:"lifecycle,omitempty"`
}

func (a activityOut) busy() string {
	if len(a.Jobs) > 0 {
		return "job " + a.Jobs[0] + " is running"
	}
	if a.AgentRunning {
		return "the Linear agent is working an issue"
	}
	return ""
}

type wakeOut struct {
	Ready  bool   `json:"ready"`
	Phase  string `json:"phase"`
	Detail string `json:"detail,omitempty"`
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
	var ping struct {
		Tailnet   *tailnet
		Lifecycle map[string]any
	}
	if err := json.Unmarshal(b, &ping); err != nil {
		return out, fmt.Errorf("host ping: %w", err)
	}
	out.Ready, out.Tailnet, out.Lifecycle = true, ping.Tailnet, ping.Lifecycle
	return out, nil
}

func (t *toolbox) activity(ctx context.Context) (activityOut, error) {
	var a activityOut
	b, err := t.host.Run(ctx, nil, "activity")
	if err != nil {
		return a, err
	}
	if err := json.Unmarshal(b, &a); err != nil {
		return a, fmt.Errorf("host activity: %w", err)
	}
	return a, nil
}

// wake moves the host one step towards taking work and says where it is:
// VM started, host booted, Linear agent started, agent up. The agent's
// start ends with check-linear-agent-webhook-live.sh, so an agent job that
// exited 0 since this boot means Linear's webhooks reach it. Until ready is
// true, nothing should be delegated: the work waits in Linear.
func (t *toolbox) wake(ctx context.Context) (wakeOut, error) {
	in, err := t.gce.Instance(ctx)
	if err != nil {
		return wakeOut{}, err
	}
	switch in.Status {
	case "RUNNING":
	case "TERMINATED", "STOPPED", "SUSPENDED":
		if err := t.gce.Start(ctx); err != nil {
			return wakeOut{}, err
		}
		return wakeOut{Phase: "vm-starting", Detail: "the host was " + in.Status + "; started it. Call host_wake again in a minute."}, nil
	default:
		return wakeOut{Phase: "vm-" + strings.ToLower(in.Status), Detail: "the host is " + in.Status + "; call host_wake again in a minute."}, nil
	}
	hs, err := t.hostStatus(ctx)
	if err != nil {
		return wakeOut{}, err
	}
	if !hs.Ready {
		return wakeOut{Phase: "host-booting", Detail: hs.Detail}, nil
	}
	b, err := t.host.Run(ctx, nil, "status", agentWorkspace)
	if err != nil {
		return wakeOut{}, err
	}
	var st struct {
		State      string `json:"state"`
		JobRunning bool   `json:"job_running"`
		JobExit    *int   `json:"job_exit"`
	}
	if err := json.Unmarshal(b, &st); err != nil {
		return wakeOut{}, fmt.Errorf("host status: %w", err)
	}
	switch {
	case st.JobRunning:
		return wakeOut{Phase: "agent-starting", Detail: "the agent's start job is running; call host_wake again in a minute."}, nil
	case st.JobExit != nil && *st.JobExit == 0 && st.State == "Running":
		// The start job's exit is history; ready means the webhook answers now.
		b, err := t.host.Run(ctx, nil, "agent-live", agentWorkspace)
		if err != nil {
			return wakeOut{}, err
		}
		var live struct {
			Live   bool   `json:"live"`
			Detail string `json:"detail"`
		}
		if err := json.Unmarshal(b, &live); err != nil {
			return wakeOut{}, fmt.Errorf("host agent-live: %w", err)
		}
		if live.Live {
			return wakeOut{Ready: true, Phase: "ready", Detail: "the Linear agent's webhook answered just now; delegate now."}, nil
		}
		if _, err := t.up(ctx, agentWorkspace, "main", true); err != nil {
			return wakeOut{}, err
		}
		return wakeOut{Phase: "agent-restarting", Detail: "the agent's webhook did not answer (" + strings.TrimSpace(live.Detail) + "); restarted the agent. Call host_wake again in a minute."}, nil
	case st.JobExit != nil && *st.JobExit != 0:
		return wakeOut{Phase: "agent-failed", Detail: fmt.Sprintf("the agent's start job exited %d; workspace_status %s has its log. agent_start retries it.", *st.JobExit, agentWorkspace)}, nil
	}
	if _, err := t.up(ctx, agentWorkspace, "main", true); err != nil {
		return wakeOut{}, err
	}
	return wakeOut{Phase: "agent-starting", Detail: "started the Linear agent; call host_wake again in a minute."}, nil
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
// shutdown is one call. It refuses while any toolbox job (workspace up,
// ship, review) is running or the Linear agent is working an issue.
func (t *toolbox) hostStop(ctx context.Context) (string, error) {
	in, err := t.gce.Instance(ctx)
	if err != nil {
		return "", err
	}
	if in.Status != "RUNNING" {
		return "", fmt.Errorf("the host is %s, not RUNNING", in.Status)
	}
	a, err := t.activity(ctx)
	if err != nil {
		return "", err
	}
	if why := a.busy(); why != "" {
		return "", fmt.Errorf("%s; wait for it before stopping the host", why)
	}
	ws, err := t.list(ctx)
	if err != nil {
		return "", err
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
	t.addCodespaceTools(s)
	mcp.AddTool(s, &mcp.Tool{
		Name:        "host_status",
		Description: "Report the GCE host VM's status and IP, whether it is ready for workspace tools, and its tailnet node. A ready host joins the tailnet (with Tailscale SSH) if it has not yet.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, hostStatusOut, error) {
		out, err := t.hostStatus(ctx)
		return nil, out, err
	})
	mcp.AddTool(s, &mcp.Tool{
		Name: "host_wake",
		Description: "Bring the host up for work, one step per call: start the VM, wait for it to boot, start the Linear agent, wait until its webhook is live. " +
			"Returns ready and the phase; call it again until ready is true before delegating anything. Pending work stays in Linear until then.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, wakeOut, error) {
		out, err := t.wake(ctx)
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
		Description: "Stop every running workspace, then stop the GCE host VM. Refuses while any job (workspace, ship or review) is running or the Linear agent is working an issue. The host also stops itself when idle or at the end of its lease; host_status shows those clocks.",
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
		Description: "Review an agent-plugins pull request with Codex on the host, against AGENTS.md, creating a container-use environment on the host and a CIT Triage issue in Linear for each finding, and pushing the environment's branch under the issue's branch name. " +
			"Returns at once; poll codex_review_status until job_exit is set.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in reviewIn) (*mcp.CallToolResult, any, error) {
		if in.Model != "" && !refRE.MatchString(in.Model) {
			return nil, nil, fmt.Errorf("model %q is not a model name", in.Model)
		}
		b, err := t.host.Run(ctx, map[string]string{"GITHUB_TOKEN": t.githubToken, "PROTON_PASS_PERSONAL_ACCESS_TOKEN": t.passToken}, "review", strconv.Itoa(in.PR), in.Model)
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name: "agent_ship",
		Description: "Ship the Linear agent's finished container-use environment, whose sandbox cannot push. Codex on the host merges it " +
			"(container-use merge) and pushes the result to branch, the issue's Linear branch name, without force. " +
			"Returns at once; poll agent_ship_status until job_exit is set.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in shipIn) (*mcp.CallToolResult, any, error) {
		if !envRE.MatchString(in.Env) {
			return nil, nil, fmt.Errorf("env %q is not a container-use environment id", in.Env)
		}
		if !refRE.MatchString(in.Branch) {
			return nil, nil, fmt.Errorf("%q is not a plain branch name", in.Branch)
		}
		if in.Branch == "main" {
			return nil, nil, fmt.Errorf("branch must be the issue's own branch, not main")
		}
		b, err := t.host.Run(ctx, map[string]string{"PROTON_PASS_PERSONAL_ACCESS_TOKEN": t.passToken}, "ship", agentWorkspace, in.Env, in.Branch)
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name: "agent_ship_status",
		Description: "Report the latest agent_ship job: its exit code (null while running), the environment and branch it was started for (request), " +
			"the commit now on GitHub once it has succeeded, Codex's last message and the end of the log.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		b, err := t.host.Run(ctx, nil, "ship-status")
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "codex_review_status",
		Description: "Report a codex_review job: its exit code (null while running), one line per finding with its container-use environment id, Linear issue, branch and title, and the end of its log.",
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

func (t *toolbox) addCodespaceTools(s *mcp.Server) {
	codespaceTool := func(name, desc string, act func(context.Context, string) (string, error)) {
		mcp.AddTool(s, &mcp.Tool{Name: name, Description: desc},
			func(ctx context.Context, _ *mcp.CallToolRequest, in codespaceIn) (*mcp.CallToolResult, any, error) {
				if !codespaceRE.MatchString(in.Name) {
					return nil, nil, fmt.Errorf("codespace name %q must be lowercase letters, digits and dashes", in.Name)
				}
				msg, err := act(ctx, in.Name)
				if err != nil {
					return nil, nil, err
				}
				return text([]byte(msg)), nil, nil
			})
	}
	codespaceTool("codespace_status", "Report whether a GitHub codespace is running, starting, stopping, stopped or rebuilding, and the repository and branch it is on.", t.codespaceStatus)
	codespaceTool("codespace_start", "Start a GitHub codespace. Returns at once; codespace_status shows when it is running, usually after a minute or two.", t.codespaceStart)
	codespaceTool("codespace_stop", "Stop a GitHub codespace. Its files are kept; codespace_start starts it again.", t.codespaceStop)
	codespaceTool("codespace_rebuild", "Rebuild a running GitHub codespace's container from the dev container config on its current branch. Only /workspaces is kept. Returns at once; codespace_status shows when it is running again, usually after a few minutes.", t.codespaceRebuild)
}

func (t *toolbox) codespaceStatus(ctx context.Context, name string) (string, error) {
	cs, err := t.codespaces.Get(ctx, name)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s is %s.", cs, cs.stateWords()), nil
}

func (t *toolbox) codespaceStart(ctx context.Context, name string) (string, error) {
	cs, err := t.codespaces.Get(ctx, name)
	if err != nil {
		return "", err
	}
	if cs.is("running") || cs.is("starting") {
		return fmt.Sprintf("%s is already %s. Nothing to do.", cs, cs.stateWords()), nil
	}
	if cs, err = t.codespaces.Start(ctx, name); err != nil {
		return "", err
	}
	return fmt.Sprintf("Asked GitHub to start %s; it is %s. codespace_status shows when it is running, usually after a minute or two.", cs, cs.stateWords()), nil
}

func (t *toolbox) codespaceStop(ctx context.Context, name string) (string, error) {
	cs, err := t.codespaces.Get(ctx, name)
	if err != nil {
		return "", err
	}
	if cs.is("stopped") || cs.is("stopping") {
		return fmt.Sprintf("%s is already %s. Nothing to do.", cs, cs.stateWords()), nil
	}
	if cs, err = t.codespaces.Stop(ctx, name); err != nil {
		return "", err
	}
	return fmt.Sprintf("Asked GitHub to stop %s; it is %s. Its files are kept; codespace_start starts it again.", cs, cs.stateWords()), nil
}

// codespaceRebuild only rebuilds a running codespace: gh would start a stopped
// one first and wait for it, which can outlast the tool call.
func (t *toolbox) codespaceRebuild(ctx context.Context, name string) (string, error) {
	cs, err := t.codespaces.Get(ctx, name)
	if err != nil {
		return "", err
	}
	if cs.is("rebuilding its container") {
		return fmt.Sprintf("%s is already %s. Nothing to do.", cs, cs.stateWords()), nil
	}
	if !cs.is("running") {
		return "", fmt.Errorf("%s is %s, and only a running codespace can be rebuilt. Start it with codespace_start, then rebuild once codespace_status says it is running", cs, cs.stateWords())
	}
	if err := t.codespaces.Rebuild(ctx, name); err != nil {
		return "", err
	}
	return fmt.Sprintf("Rebuilding %s from %s. Only /workspaces is kept; codespace_status shows when it is running again, usually after a few minutes.", cs, cs.config()), nil
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
