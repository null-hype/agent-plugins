package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// codespaceAPI starts and stops the token owner's GitHub codespaces (CIT-436).
type codespaceAPI interface {
	// Start and Stop return the codespace's state once GitHub has accepted
	// the request, e.g. Starting or ShuttingDown.
	Start(ctx context.Context, name string) (string, error)
	Stop(ctx context.Context, name string) (string, error)
}

// codespaces calls the GitHub REST API. The token needs the Codespaces
// lifecycle admin permission.
type codespaces struct {
	client *http.Client
	url    string // https://api.github.com/user/codespaces
	token  string
}

func (c *codespaces) post(ctx context.Context, name, action string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url+"/"+name+"/"+action, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return "", fmt.Errorf("codespace %s %s: %s: %s", action, name, resp.Status, strings.TrimSpace(string(body)))
	}
	var v struct{ State string }
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return "", fmt.Errorf("codespace %s %s: %w", action, name, err)
	}
	return v.State, nil
}

func (c *codespaces) Start(ctx context.Context, name string) (string, error) {
	return c.post(ctx, name, "start")
}

func (c *codespaces) Stop(ctx context.Context, name string) (string, error) {
	return c.post(ctx, name, "stop")
}
