// Command toolbox is an MCP server on Render that manages DevPod workspaces
// on one GCE host VM (CIT-430). Its first client is the Linear Agent, through
// a custom MCP connector that sends "Authorization: Bearer <TOOLBOX_TOKEN>".
//
// The host keeps all DevPod state; this server keeps none. It starts and
// stops the VM through the Compute API and runs host.sh on it over SSH.
// Long work runs as a job on the host, because the Linear Agent gives up on a
// tool call after 3 minutes.
//
// Every request's path and auth scheme are logged; token values never are.
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
	"golang.org/x/crypto/ssh"
)

type pingOut struct {
	Time string `json:"time"`
}

// newServer returns the MCP server. With tb nil it has only ping, so the
// service still answers before the infrastructure secrets are configured.
func newServer(tb *toolbox) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "toolbox", Version: "0.1"}, nil)
	mcp.AddTool(s, &mcp.Tool{
		Name:        "ping",
		Description: "Return the server's current time. Use it to check that the toolbox is reachable.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, pingOut, error) {
		return nil, pingOut{Time: time.Now().UTC().Format(time.RFC3339)}, nil
	})
	if tb != nil {
		tb.addTools(s)
	}
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

func newMux(token, baseURL string, tb *toolbox) *http.ServeMux {
	// The SDK's DNS rebinding protection 403s requests that arrive on a
	// loopback address with a public Host header, which is how Render's proxy
	// delivers every request. It guards servers on a developer's machine; this
	// one is public and guarded by the bearer token.
	mcpHandler := http.Handler(mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return newServer(tb) },
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
	// A separate Linear data-change webhook can use the toolbox as the
	// private-check controller. It is authenticated by Linear's HMAC, not the
	// MCP bearer token. No route exists until its dedicated secret is set.
	if tb != nil {
		if secret := os.Getenv("LINEAR_CHECK_WEBHOOK_SECRET"); secret != "" {
			mux.Handle("/linear/webhook", linearRerunHandler(secret, newRerunController(tb)))
		}
	}
	// No authorization server exists: Linear sends a static bearer header.
	// Listing none tells an OAuth client there is nothing to log in with.
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

func envOr(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

// loadToolbox builds the infrastructure tools from the environment. It
// returns nil, and the server offers only ping, until every secret is set.
func loadToolbox(ctx context.Context) (*toolbox, error) {
	required := []string{"GCP_SERVICE_ACCOUNT_KEY", "TOOLBOX_SSH_KEY", "GITHUB_TOKEN", "PROTON_PASS_PERSONAL_ACCESS_TOKEN"}
	var missing []string
	for _, k := range required {
		if os.Getenv(k) == "" {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		log.Printf("toolbox: infrastructure tools off; unset: %s", strings.Join(missing, ", "))
		return nil, nil
	}
	g, err := newGCE(ctx, []byte(os.Getenv("GCP_SERVICE_ACCOUNT_KEY")),
		envOr("TOOLBOX_HOST_ZONE", "us-central1-a"), envOr("TOOLBOX_HOST_NAME", "toolbox-host"))
	if err != nil {
		return nil, err
	}
	signer, err := ssh.ParsePrivateKey([]byte(os.Getenv("TOOLBOX_SSH_KEY")))
	if err != nil {
		return nil, fmt.Errorf("TOOLBOX_SSH_KEY: %w", err)
	}
	return &toolbox{
		gce:         g,
		host:        &sshHost{gce: g, user: "toolbox", signer: signer},
		codespaces:  &codespaces{client: http.DefaultClient, url: "https://api.github.com/user/codespaces", token: os.Getenv("GITHUB_TOKEN"), gh: "/usr/local/bin/gh"},
		githubToken: os.Getenv("GITHUB_TOKEN"),
		passToken:   os.Getenv("PROTON_PASS_PERSONAL_ACCESS_TOKEN"),
		tsAuthKey:   os.Getenv("TS_AUTHKEY"),
	}, nil
}

func main() {
	port := envOr("PORT", "8080")
	// Render sets RENDER_EXTERNAL_URL on web services.
	baseURL := strings.TrimSuffix(os.Getenv("RENDER_EXTERNAL_URL"), "/")
	if baseURL == "" {
		baseURL = "http://localhost:" + port
	}
	tb, err := loadToolbox(context.Background())
	if err != nil {
		log.Fatalf("toolbox: %v", err)
	}
	token := os.Getenv("TOOLBOX_TOKEN")
	if tb != nil && token == "" {
		log.Fatal("toolbox: infrastructure tools need TOOLBOX_TOKEN")
	}
	log.Printf("toolbox: listening on :%s, bearer auth %t, infrastructure tools %t", port, token != "", tb != nil)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           logRequests(newMux(token, baseURL, tb)),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}
