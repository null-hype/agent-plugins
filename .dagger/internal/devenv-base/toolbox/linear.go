package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// linearAPI writes to Linear's GraphQL API with a personal API key: the check
// rerun's comments and state changes. Only the toolbox holds the key; the
// host and the checks it runs never see it.
type linearAPI struct {
	client *http.Client
	url    string
	key    string
}

func newLinearAPI(key string) *linearAPI {
	return &linearAPI{client: http.DefaultClient, url: "https://api.linear.app/graphql", key: key}
}

func (l *linearAPI) comment(ctx context.Context, issueID, body string) error {
	return l.mutate(ctx, "commentCreate",
		`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
		map[string]any{"input": map[string]any{"issueId": issueID, "body": body}})
}

func (l *linearAPI) setState(ctx context.Context, issueID, stateID string) error {
	return l.mutate(ctx, "issueUpdate",
		`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
		map[string]any{"id": issueID, "input": map[string]any{"stateId": stateID}})
}

// mutate runs one mutation and requires its `success`.
func (l *linearAPI) mutate(ctx context.Context, name, query string, vars map[string]any) error {
	body, err := json.Marshal(map[string]any{"query": query, "variables": vars})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, l.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	// A personal API key goes as it is, without "Bearer".
	req.Header.Set("Authorization", l.key)
	resp, err := l.client.Do(req)
	if err != nil {
		return fmt.Errorf("linear %s: %w", name, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("linear %s: %w", name, err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("linear %s: %s: %s", name, resp.Status, lastLines(string(b), 5))
	}
	var out struct {
		Data   map[string]struct{ Success bool } `json:"data"`
		Errors []struct{ Message string }        `json:"errors"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return fmt.Errorf("linear %s: %w", name, err)
	}
	if len(out.Errors) > 0 {
		return fmt.Errorf("linear %s: %s", name, out.Errors[0].Message)
	}
	if !out.Data[name].Success {
		return fmt.Errorf("linear %s: not successful", name)
	}
	return nil
}
