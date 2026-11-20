package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"regexp"
	"strconv"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// A claude-shadow is a persistent interactive Claude Code session in a
// workspace, kept by a Herdr server whose session is named after the workspace
// (start-shadow.sh). The shadow_* tools proxy Herdr's agent API into it, so a
// remote client needs only the toolbox's bearer token. host.sh runs Herdr in the
// container through devpod ssh.
var (
	// A Herdr agent name or pane id such as w1:p1. It starts with a letter or
	// digit, so it can never be read as a flag.
	shadowTargetRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9:_-]{0,39}$`)
	// A Claude session id, as `claude --resume` takes.
	sessionIDRE = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)
	// A Delta thread join link, as delta.dev/docs/cli/claude-code shows it.
	deltaThreadRE = regexp.MustCompile(`^https://delta\.dev/join/thread_[A-Za-z0-9_-]{1,100}$`)
)

const (
	defaultShadowTarget = "w1:p1"
	defaultReadLines    = 80
	maxReadLines        = 500
	// A tool call is cut off at 150 seconds (toolCallTimeout): the prompt's
	// wait has to end, and devpod ssh start and return, inside it.
	defaultPromptTimeoutMS = 90000
	minPromptTimeoutMS     = 5000
	maxPromptTimeoutMS     = 110000
	maxPromptBytes         = 8000
)

type shadowReadIn struct {
	Name   string `json:"name" jsonschema:"workspace name of the shadow, e.g. claude-shadow"`
	Target string `json:"target,omitempty" jsonschema:"Herdr pane id or agent name; default w1:p1"`
	Lines  int    `json:"lines,omitempty" jsonschema:"how many of the last rendered terminal rows to read, 1 to 500; default 80"`
}

type shadowPromptIn struct {
	Name      string `json:"name" jsonschema:"workspace name of the shadow, e.g. claude-shadow"`
	Text      string `json:"text" jsonschema:"the prompt to send; at most 8000 bytes"`
	Target    string `json:"target,omitempty" jsonschema:"Herdr pane id or agent name; default w1:p1"`
	TimeoutMS int    `json:"timeout_ms,omitempty" jsonschema:"how long to wait for the agent to finish, 5000 to 110000; default 90000"`
}

// checkShadowTarget returns the target, or the default for an empty one.
func checkShadowTarget(target string) (string, error) {
	if target == "" {
		return defaultShadowTarget, nil
	}
	if !shadowTargetRE.MatchString(target) {
		return "", fmt.Errorf("target %q must be a Herdr pane id or agent name such as w1:p1", target)
	}
	return target, nil
}

// upShadow is workspace_up for a shadow: host.sh creates the workspace from
// the config that mounts a home volume, then runs start-shadow.sh. A session id
// is optional; start-shadow.sh remembers the last one it was given. A Delta thread
// link is optional too: Claude joins it once.
func (t *toolbox) upShadow(ctx context.Context, name, ref, sessionID, deltaThread string) ([]byte, error) {
	env := map[string]string{"GITHUB_TOKEN": t.githubToken}
	if sessionID != "" {
		env["SHADOW_SESSION_ID"] = sessionID
	}
	if deltaThread != "" {
		env["SHADOW_DELTA_THREAD"] = deltaThread
	}
	return t.host.Run(ctx, env, "up", name, ref, "0", "1")
}

func (t *toolbox) addShadowTools(s *mcp.Server) {
	mcp.AddTool(s, &mcp.Tool{
		Name: "shadow_list",
		Description: "List the agents and panes of a workspace's claude-shadow, from the Herdr session named after the workspace. " +
			"Read-only. The workspace must be running (workspace_up with shadow true starts it); workspace_status shows whether the shadow is up and logged in.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in nameIn) (*mcp.CallToolResult, any, error) {
		if err := checkName(in.Name); err != nil {
			return nil, nil, err
		}
		b, err := t.host.Run(ctx, nil, "shadow-list", in.Name)
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name: "shadow_read",
		Description: "Read the last rows of a shadow pane's terminal (Herdr pane read, recent output without soft wrapping). " +
			"Read-only. Use it to see what the shadow answered or what it is waiting on.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in shadowReadIn) (*mcp.CallToolResult, any, error) {
		if err := checkName(in.Name); err != nil {
			return nil, nil, err
		}
		target, err := checkShadowTarget(in.Target)
		if err != nil {
			return nil, nil, err
		}
		lines := in.Lines
		if lines == 0 {
			lines = defaultReadLines
		}
		if lines < 1 || lines > maxReadLines {
			return nil, nil, fmt.Errorf("lines %d must be between 1 and %d", lines, maxReadLines)
		}
		b, err := t.host.Run(ctx, nil, "shadow-read", in.Name, target, strconv.Itoa(lines))
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name: "shadow_prompt",
		Description: "Send a prompt to a workspace's claude-shadow and wait, up to timeout_ms, for it to finish (Herdr agent prompt --wait). " +
			"An error after the wait times out does not prove the prompt was not delivered: shadow_read shows the pane before you retry. " +
			"Refused by Herdr while the agent is blocked on a question; read the pane and answer it from a terminal.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in shadowPromptIn) (*mcp.CallToolResult, any, error) {
		if err := checkName(in.Name); err != nil {
			return nil, nil, err
		}
		target, err := checkShadowTarget(in.Target)
		if err != nil {
			return nil, nil, err
		}
		if in.Text == "" {
			return nil, nil, fmt.Errorf("text is empty")
		}
		if len(in.Text) > maxPromptBytes || !utf8.ValidString(in.Text) {
			return nil, nil, fmt.Errorf("text must be valid UTF-8 of at most %d bytes", maxPromptBytes)
		}
		timeout := in.TimeoutMS
		if timeout == 0 {
			timeout = defaultPromptTimeoutMS
		}
		if timeout < minPromptTimeoutMS || timeout > maxPromptTimeoutMS {
			return nil, nil, fmt.Errorf("timeout_ms %d must be between %d and %d", timeout, minPromptTimeoutMS, maxPromptTimeoutMS)
		}
		// base64, so the text never meets a shell on the host or in the container.
		b, err := t.host.Run(ctx, nil, "shadow-prompt", in.Name, target, strconv.Itoa(timeout), base64.StdEncoding.EncodeToString([]byte(in.Text)))
		if err != nil {
			return nil, nil, err
		}
		return text(b), nil, nil
	})
}
