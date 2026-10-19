package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"golang.org/x/crypto/ssh"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// instance is what the toolbox needs to know about the host VM.
type instance struct {
	Status string `json:"status"` // PROVISIONING, STAGING, RUNNING, STOPPING, TERMINATED, ...
	IP     string `json:"ip,omitempty"`
}

// computeAPI is the host VM as seen through the Compute Engine API.
type computeAPI interface {
	Instance(ctx context.Context) (instance, error)
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	// HostKeys returns the SSH host keys the guest agent published as guest
	// attributes, so the toolbox can verify the host without trusting on
	// first use.
	HostKeys(ctx context.Context) ([]ssh.PublicKey, error)
}

// gce calls the Compute Engine REST API for one instance.
type gce struct {
	client *http.Client
	url    string // .../projects/P/zones/Z/instances/N
}

func newGCE(ctx context.Context, keyJSON []byte, zone, name string) (*gce, error) {
	creds, err := google.CredentialsFromJSON(ctx, keyJSON, "https://www.googleapis.com/auth/compute")
	if err != nil {
		return nil, fmt.Errorf("GCP service account key: %w", err)
	}
	if creds.ProjectID == "" {
		return nil, fmt.Errorf("GCP service account key names no project")
	}
	return &gce{
		client: oauth2.NewClient(ctx, creds.TokenSource),
		url: fmt.Sprintf("https://compute.googleapis.com/compute/v1/projects/%s/zones/%s/instances/%s",
			creds.ProjectID, zone, name),
	}, nil
}

func (g *gce) call(ctx context.Context, method, suffix string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, g.url+suffix, nil)
	if err != nil {
		return err
	}
	resp, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("compute %s %s: %s: %s", method, suffix, resp.Status, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (g *gce) Instance(ctx context.Context) (instance, error) {
	var v struct {
		Status            string
		NetworkInterfaces []struct {
			AccessConfigs []struct{ NatIP string }
		}
	}
	if err := g.call(ctx, http.MethodGet, "", &v); err != nil {
		return instance{}, err
	}
	in := instance{Status: v.Status}
	for _, ni := range v.NetworkInterfaces {
		for _, ac := range ni.AccessConfigs {
			if ac.NatIP != "" && in.IP == "" {
				in.IP = ac.NatIP
			}
		}
	}
	return in, nil
}

// Start and Stop return once Compute has accepted the operation; the VM's
// status shows when it has finished.
func (g *gce) Start(ctx context.Context) error {
	return g.call(ctx, http.MethodPost, "/start", nil)
}

func (g *gce) Stop(ctx context.Context) error {
	return g.call(ctx, http.MethodPost, "/stop", nil)
}

func (g *gce) HostKeys(ctx context.Context) ([]ssh.PublicKey, error) {
	var v struct {
		QueryValue struct {
			Items []struct{ Key, Value string }
		}
	}
	if err := g.call(ctx, http.MethodGet, "/getGuestAttributes?queryPath=hostkeys%2F", &v); err != nil {
		return nil, err
	}
	return parseHostKeys(v.QueryValue.Items)
}

// parseHostKeys reads guest attribute items whose key is the key type and
// whose value is the base64 key, with or without the type in front.
func parseHostKeys(items []struct{ Key, Value string }) ([]ssh.PublicKey, error) {
	var keys []ssh.PublicKey
	for _, it := range items {
		line := strings.TrimSpace(it.Value)
		if !strings.Contains(line, " ") {
			line = it.Key + " " + line
		}
		k, _, _, _, err := ssh.ParseAuthorizedKey([]byte(line))
		if err != nil {
			return nil, fmt.Errorf("host key %s: %w", it.Key, err)
		}
		keys = append(keys, k)
	}
	return keys, nil
}
