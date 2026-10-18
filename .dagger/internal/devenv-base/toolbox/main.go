// Command toolbox is the CIT-430 spike: an MCP server on Render whose only
// job is to show how the Linear Agent connects to a custom MCP server. It has
// no DevPod or GCE access yet.
//
// It answers two questions:
//   - auth: does Linear send a static bearer header, or does it go looking
//     for OAuth (/.well-known/*)? Every request's path and auth scheme are
//     logged; token values never are.
//   - time: how long will Linear wait on one tool call? slow_ping sleeps for
//     as long as it is asked to.
//
// With TOOLBOX_TOKEN set, /mcp requires "Authorization: Bearer <token>" and a
// 401 carries a resource_metadata hint, so an OAuth-capable client shows
// itself by fetching it. Without TOOLBOX_TOKEN, /mcp is open, which is fine
// for tools that only echo the time.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const maxSlowPing = 15 * time.Minute

type pingOut struct {
	Time string `json:"time"`
}

type slowPingIn struct {
	Seconds int `json:"seconds" jsonschema:"how long to wait before answering, in seconds"`
}

type slowPingOut struct {
	Started  string `json:"started"`
	Finished string `json:"finished"`
}

func newServer() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "toolbox", Version: "spike"}, nil)
	mcp.AddTool(s, &mcp.Tool{
		Name:        "ping",
		Description: "Return the server's current time. Use it to check that the toolbox is reachable.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, pingOut, error) {
		return nil, pingOut{Time: time.Now().UTC().Format(time.RFC3339)}, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "slow_ping",
		Description: "Wait the given number of seconds, then return when the wait started and finished. Used to measure how long a caller waits on one tool call.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in slowPingIn) (*mcp.CallToolResult, slowPingOut, error) {
		d := time.Duration(in.Seconds) * time.Second
		if d < 0 || d > maxSlowPing {
			return nil, slowPingOut{}, fmt.Errorf("seconds must be between 0 and %d", int(maxSlowPing.Seconds()))
		}
		started := time.Now().UTC()
		log.Printf("slow_ping: waiting %s", d)
		select {
		case <-time.After(d):
		case <-ctx.Done():
			// The caller gave up: this is the number the spike is after.
			log.Printf("slow_ping: caller went away after %s: %v", time.Since(started).Round(time.Second), ctx.Err())
			return nil, slowPingOut{}, ctx.Err()
		}
		log.Printf("slow_ping: answered after %s", d)
		return nil, slowPingOut{Started: started.Format(time.RFC3339), Finished: time.Now().UTC().Format(time.RFC3339)}, nil
	})
	return s
}

// authScheme names the scheme of an Authorization header without its value.
func authScheme(h string) string {
	if h == "" {
		return "none"
	}
	scheme, _, _ := strings.Cut(h, " ")
	return scheme
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s auth=%s ua=%q mcp-session=%t", r.Method, r.URL.Path,
			authScheme(r.Header.Get("Authorization")), r.UserAgent(), r.Header.Get("Mcp-Session-Id") != "")
		next.ServeHTTP(w, r)
	})
}

func requireBearer(token, metadataURL string, next http.Handler) http.Handler {
	want := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), want) != 1 {
			w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer resource_metadata=%q`, metadataURL))
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func newMux(token, baseURL string) *http.ServeMux {
	// The SDK's DNS rebinding protection 403s requests that arrive on a
	// loopback address with a public Host header, which is how Render's proxy
	// delivers every request. It guards servers on a developer's machine; this
	// one is public and guarded by the bearer token.
	mcpHandler := http.Handler(mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return newServer() },
		&mcp.StreamableHTTPOptions{DisableLocalhostProtection: true}))
	metadataURL := baseURL + "/.well-known/oauth-protected-resource"
	if token != "" {
		mcpHandler = requireBearer(token, metadataURL, mcpHandler)
	}

	mux := http.NewServeMux()
	mux.Handle("/mcp", mcpHandler)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "ok")
	})
	// No authorization server exists yet. Listing none tells an OAuth client
	// there is nothing to log in with; the log line is the finding.
	mux.HandleFunc("/.well-known/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("oauth discovery: %s", r.URL.Path)
		if r.URL.Path != "/.well-known/oauth-protected-resource" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"resource":              baseURL + "/mcp",
			"authorization_servers": []string{},
		})
	})
	return mux
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	// Render sets RENDER_EXTERNAL_URL on web services.
	baseURL := strings.TrimSuffix(os.Getenv("RENDER_EXTERNAL_URL"), "/")
	if baseURL == "" {
		baseURL = "http://localhost:" + port
	}
	token := os.Getenv("TOOLBOX_TOKEN")
	log.Printf("toolbox: listening on :%s, bearer auth %t", port, token != "")
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           logRequests(newMux(token, baseURL)),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}
