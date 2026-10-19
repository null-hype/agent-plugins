package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type bearerTransport struct{ token string }

func (t bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+t.token)
	return http.DefaultTransport.RoundTrip(r)
}

func connect(t *testing.T, url string, httpClient *http.Client) (*mcp.ClientSession, error) {
	t.Helper()
	c := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	return c.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: url + "/mcp", HTTPClient: httpClient}, nil)
}

func TestPingWithBearer(t *testing.T) {
	ts := httptest.NewServer(newMux("s3cret", "http://example.test", nil))
	defer ts.Close()

	cs, err := connect(t, ts.URL, &http.Client{Transport: bearerTransport{"s3cret"}})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer cs.Close()

	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "ping"})
	if err != nil {
		t.Fatalf("call ping: %v", err)
	}
	if res.IsError {
		t.Fatalf("ping returned an error: %+v", res.Content)
	}
}

func TestWrongTokenGets401WithMetadataHint(t *testing.T) {
	ts := httptest.NewServer(newMux("s3cret", "http://example.test", nil))
	defer ts.Close()

	if _, err := connect(t, ts.URL, &http.Client{Transport: bearerTransport{"wrong"}}); err == nil {
		t.Fatal("connected with the wrong token")
	}

	resp, err := http.Post(ts.URL+"/mcp", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", resp.StatusCode)
	}
	want := `Bearer resource_metadata="http://example.test/.well-known/oauth-protected-resource"`
	if got := resp.Header.Get("WWW-Authenticate"); got != want {
		t.Fatalf("WWW-Authenticate %q, want %q", got, want)
	}
}

func TestOpenWithoutToken(t *testing.T) {
	ts := httptest.NewServer(newMux("", "http://example.test", nil))
	defer ts.Close()

	cs, err := connect(t, ts.URL, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	cs.Close()
}

// Render's proxy reaches the server on loopback with the public Host header.
func TestPublicHostOverLoopbackIsServed(t *testing.T) {
	ts := httptest.NewServer(newMux("", "http://example.test", nil))
	defer ts.Close()

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/mcp", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "toolbox-spike.onrender.com"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden {
		t.Fatal("403 for a public Host header arriving on loopback")
	}
}

func TestAuthSchemeNeverReturnsTheToken(t *testing.T) {
	for in, want := range map[string]string{"": "none", "Bearer abc": "Bearer", "Basic xyz": "Basic"} {
		if got := authScheme(in); got != want {
			t.Errorf("authScheme(%q) = %q, want %q", in, got, want)
		}
	}
}
