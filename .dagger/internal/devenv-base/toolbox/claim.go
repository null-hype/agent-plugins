package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
)

// claimIssue is current Linear metadata, fetched after the check finishes.
// The identifier is the public slug: renaming a claim cannot move its URL.
type claimIssue struct {
	ID          string `json:"id"`
	Identifier  string `json:"identifier"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Labels      struct {
		Nodes []struct {
			Name string `json:"name"`
		} `json:"nodes"`
	} `json:"labels"`
}

func (i claimIssue) public() bool {
	for _, label := range i.Labels.Nodes {
		if label.Name == "public" {
			return true
		}
	}
	return false
}

type claimSnapshot struct {
	ID     string `json:"id"`
	URL    string `json:"url,omitempty"`
	RunKey string `json:"run_key"`
}

// completedClaim is also the fixture boundary for publishing without a host,
// Linear writes or Dagger. Xeno is deliberately an empty integration slot.
type completedClaim struct {
	Issue    claimIssue    `json:"issue"`
	Delivery string        `json:"delivery"`
	Check    string        `json:"check"`
	Exit     int           `json:"exit"`
	Trace    string        `json:"trace"`
	Snapshot claimSnapshot `json:"snapshot"`
	Xeno     any           `json:"xeno"`
}

type claimPublisher struct {
	client    *http.Client
	endpoint  string
	bucket    string
	baseURL   string
	accessKey string
	secretKey string
	urlSecret string
}

func loadClaimPublisher() *claimPublisher {
	required := []string{"R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CLAIM_URL_SECRET"}
	var missing []string
	for _, key := range required {
		if os.Getenv(key) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		log.Printf("toolbox: claim publishing off; unset: %s", strings.Join(missing, ", "))
		return nil
	}
	p := &claimPublisher{
		client:   &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		endpoint: strings.TrimRight(os.Getenv("R2_ENDPOINT"), "/"), bucket: os.Getenv("R2_BUCKET"),
		baseURL:   strings.TrimRight(envOr("CLAIM_BASE_URL", "https://check.tidelands.dev"), "/"),
		accessKey: os.Getenv("R2_ACCESS_KEY_ID"), secretKey: os.Getenv("R2_SECRET_ACCESS_KEY"), urlSecret: os.Getenv("CLAIM_URL_SECRET"),
	}
	for _, raw := range []string{p.endpoint, p.baseURL} {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
			log.Printf("toolbox: claim publishing off; R2_ENDPOINT and CLAIM_BASE_URL must be HTTPS origins")
			return nil
		}
	}
	if len(p.urlSecret) < 32 {
		log.Printf("toolbox: claim publishing off; CLAIM_URL_SECRET must contain at least 32 random bytes")
		return nil
	}
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9.-]*$`).MatchString(p.bucket) {
		log.Printf("toolbox: claim publishing off; invalid R2_BUCKET")
		return nil
	}
	return p
}

func (p *claimPublisher) path(issue claimIssue) (string, error) {
	if issue.ID == "" || !regexp.MustCompile(`^[A-Za-z]+-[0-9]+$`).MatchString(issue.Identifier) {
		return "", fmt.Errorf("claim needs an issue ID and identifier")
	}
	if issue.public() {
		return "/" + strings.ToLower(issue.Identifier), nil
	}
	mac := hmac.New(sha256.New, []byte(p.urlSecret))
	mac.Write([]byte("claim-page-v1:" + issue.ID))
	return "/r/" + hex.EncodeToString(mac.Sum(nil)), nil
}

func (p *claimPublisher) publish(ctx context.Context, claim completedClaim) (string, error) {
	path, err := p.path(claim.Issue)
	if err != nil {
		return "", err
	}
	publishedURL := p.baseURL + path
	if !claim.Issue.public() {
		// Arbitrary S3 metadata is not an HTTP response header on an R2 custom
		// domain. Require the edge rule, including on 404s, before exposing HTML.
		req, err := http.NewRequestWithContext(ctx, http.MethodHead, publishedURL, nil)
		if err != nil {
			return "", err
		}
		resp, err := p.client.Do(req)
		if err != nil {
			return "", fmt.Errorf("verify private noindex: %w", err)
		}
		resp.Body.Close()
		noindex := false
		for _, directive := range strings.Split(strings.Join(resp.Header.Values("X-Robots-Tag"), ","), ",") {
			if strings.TrimSpace(strings.ToLower(directive)) == "noindex" {
				noindex = true
			}
		}
		if (resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound) || !noindex {
			return "", fmt.Errorf("private publishing requires the /r/* X-Robots-Tag: noindex edge rule (HTTP %d)", resp.StatusCode)
		}
	}
	body, err := renderClaim(claim)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, p.endpoint+"/"+p.bucket+path, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "text/html; charset=utf-8")
	req.Header.Set("Cache-Control", "no-store")
	digest := sha256.Sum256(body)
	hash := hex.EncodeToString(digest[:])
	req.Header.Set("X-Amz-Content-Sha256", hash)
	if err := v4.NewSigner().SignHTTP(ctx, aws.Credentials{AccessKeyID: p.accessKey, SecretAccessKey: p.secretKey}, req, hash, "s3", "auto", time.Now().UTC()); err != nil {
		return "", err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("R2 upload: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("R2 upload: HTTP %d", resp.StatusCode)
	}
	return publishedURL, nil
}

func renderClaim(claim completedClaim) ([]byte, error) {
	data, err := json.Marshal(claim) // encoding/json escapes HTML, including </script>.
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	err = claimTemplate.Execute(&out, struct {
		completedClaim
		Data   template.JS
		Public bool
	}{claim, template.JS(data), claim.Issue.public()})
	return out.Bytes(), err
}

var claimTemplate = template.Must(template.New("claim").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Issue.Title}}</title>{{if not .Public}}<meta name="robots" content="noindex">{{end}}
<meta name="referrer" content="no-referrer">
<style>body{font:18px/1.6 system-ui,sans-serif;max-width:52rem;margin:3rem auto;padding:0 1.2rem;color:#18212b}h1{line-height:1.2}.description{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}dt{font-weight:600}dd{margin:0 0 1rem}a{color:#1658a0}</style>
</head><body><main>
<p>{{.Issue.Identifier}}</p><h1>{{.Issue.Title}}</h1>
<div class="description">{{.Issue.Description}}</div>
<h2>Latest rerun</h2><p>{{if eq .Exit 0}}Green{{else}}Red{{end}} · <code>{{.Check}}</code> · Dagger exit {{.Exit}}</p>
<dl><dt>Dagger trace</dt><dd>{{if .Trace}}<a href="{{.Trace}}" rel="noreferrer">Open trace</a>{{else}}Unavailable{{end}}</dd>
<dt id="restic-snapshot">Restic snapshot</dt><dd>{{if .Snapshot.ID}}<code>{{.Snapshot.ID}}</code>{{if .Snapshot.URL}} · <a href="{{.Snapshot.URL}}" rel="noreferrer">Snapshot evidence</a>{{end}}{{else}}Unavailable for this rerun{{end}}<br>Run key: <code>{{.Snapshot.RunKey}}</code></dd>
<dt>Linear delivery</dt><dd><code>{{.Delivery}}</code></dd></dl>
<section id="xeno-status" data-status="pending"><h2>Xeno status</h2><p>Status component pending.</p></section>
<script id="claim-data" type="application/json">{{.Data}}</script>
</main></body></html>`))

// Local proof boundary: the real renderer/uploader accepts a completed fixture.
func runClaimCommand(ctx context.Context, command string, in io.Reader, out io.Writer) error {
	var claim completedClaim
	decoder := json.NewDecoder(io.LimitReader(in, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&claim); err != nil {
		return fmt.Errorf("completed claim: %w", err)
	}
	if claim.Issue.ID == "" || claim.Issue.Identifier == "" || claim.Check == "" {
		return fmt.Errorf("completed claim needs issue identity and check")
	}
	if command == "render-claim" {
		body, err := renderClaim(claim)
		if err != nil {
			return err
		}
		_, err = out.Write(body)
		return err
	}
	p := loadClaimPublisher()
	if p == nil {
		return fmt.Errorf("claim publishing is disabled; see configuration log")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	publishedURL, err := p.publish(ctx, claim)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(out, publishedURL)
	return err
}
