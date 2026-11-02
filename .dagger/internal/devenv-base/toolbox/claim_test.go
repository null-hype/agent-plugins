package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func fakeClaim(t *testing.T, public bool) completedClaim {
	t.Helper()
	var claim completedClaim
	if err := json.Unmarshal([]byte(`{"issue":{"id":"issue-uuid","identifier":"INF-6","title":"A claim <script>alert(1)</script>","description":"First line\n</script><script>bad()</script>"},"delivery":"delivery-1","check":"registered-delivery","exit":0,"trace":"https://dagger.cloud/test/traces/abc","snapshot":{"id":"abcdef0123456789","url":"https://dagger.cloud/test/traces/abc","run_key":"linear-inf-6"},"xeno":null}`), &claim); err != nil {
		t.Fatal(err)
	}
	if public {
		if err := json.Unmarshal([]byte(`{"nodes":[{"name":"public"}]}`), &claim.Issue.Labels); err != nil {
			t.Fatal(err)
		}
	}
	return claim
}

// Exercise the production S3 upload against a local HTTP bucket, including
// signing, exact object keys, overwrite behavior, HTML and the returned URL.
func TestClaimPublishesAndOverwrites(t *testing.T) {
	for _, public := range []bool{false, true} {
		t.Run(fmt.Sprint("public=", public), func(t *testing.T) {
			objects := map[string]string{}
			puts, heads := 0, 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.Method {
				case http.MethodHead:
					heads++
					w.Header().Set("X-Robots-Tag", "noindex")
					w.WriteHeader(http.StatusNotFound)
				case http.MethodPut:
					puts++
					body, _ := io.ReadAll(r.Body)
					sum := sha256.Sum256(body)
					if r.Header.Get("X-Amz-Content-Sha256") != hex.EncodeToString(sum[:]) {
						t.Error("wrong payload hash")
					}
					if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=test-key/") || !strings.Contains(r.Header.Get("Authorization"), "/auto/s3/aws4_request") {
						t.Error("missing R2 signature")
					}
					if r.Header.Get("Content-Type") != "text/html; charset=utf-8" || r.Header.Get("Cache-Control") != "no-store" {
						t.Error("missing HTML/cache metadata")
					}
					objects[r.URL.Path] = string(body)
				default:
					t.Errorf("unexpected %s", r.Method)
				}
			}))
			defer srv.Close()
			p := &claimPublisher{client: srv.Client(), endpoint: srv.URL, bucket: "claims", baseURL: srv.URL, accessKey: "test-key", secretKey: "test-secret", urlSecret: strings.Repeat("s", 32)}
			claim := fakeClaim(t, public)
			claim.Issue.Title = "Registered Delivery"
			first, err := p.publish(context.Background(), claim)
			if err != nil {
				t.Fatal(err)
			}
			claim.Issue.Description = "Updated claim description"
			claim.Delivery = "delivery-2"
			claim.Exit = 1
			second, err := p.publish(context.Background(), claim)
			if err != nil {
				t.Fatal(err)
			}
			if first != second || len(objects) != 1 || puts != 2 {
				t.Fatalf("URL/object changed: %s %s %v", first, second, objects)
			}
			if public && (first != srv.URL+"/registered-delivery" || heads != 0) {
				t.Fatalf("public URL=%s HEADs=%d", first, heads)
			}
			if !public && (!strings.HasPrefix(first, srv.URL+"/r/") || heads != 2 || len(strings.TrimPrefix(first, srv.URL+"/r/")) != 64) {
				t.Fatalf("private URL=%s HEADs=%d", first, heads)
			}
			body := objects["/claims"+strings.TrimPrefix(first, srv.URL)]
			for _, part := range []string{"Red", "Dagger exit 1", "Registered Delivery", "Updated claim description", "linear-inf-6", "abcdef0123456789", "Snapshot evidence", `id="xeno-status"`, `"xeno":null`} {
				if !strings.Contains(body, part) {
					t.Errorf("missing %q", part)
				}
			}
			// A new process with the same independent URL secret produces the same path.
			restarted := *p
			restarted.accessKey = "rotated-access-key"
			restarted.secretKey = "rotated-secret"
			path, _ := restarted.path(claim.Issue)
			if p.baseURL+path != first {
				t.Fatal("URL changed across restart/credential rotation")
			}
			other := claim.Issue
			other.ID = "other-uuid"
			if !public {
				otherPath, _ := p.path(other)
				if path == otherPath {
					t.Fatal("private issue tokens collide")
				}
			}
		})
	}
}

func TestClaimTitleSlug(t *testing.T) {
	p := &claimPublisher{urlSecret: strings.Repeat("s", 32)}
	for _, tc := range []struct{ title, path string }{
		{"Registered Delivery", "/registered-delivery"},
		{"  Publish a CLAIM: title / with___spaces & punctuation!  ", "/publish-a-claim-title-with-spaces-punctuation"},
		{"Already--kebab-case 123", "/already-kebab-case-123"},
		{"Café Überprüfung", "/café-überprüfung"},
		{"", ""},
		{" /...?!_ ", ""},
	} {
		t.Run(tc.title, func(t *testing.T) {
			claim := fakeClaim(t, true)
			claim.Issue.Title = tc.title
			got, err := p.path(claim.Issue)
			if got != tc.path || (err != nil) != (tc.path == "") {
				t.Fatalf("path=%q err=%v; want %q", got, err, tc.path)
			}
		})
	}
	for _, public := range []bool{false, true} {
		claim := fakeClaim(t, public)
		before, err := p.path(claim.Issue)
		if err != nil {
			t.Fatal(err)
		}
		claim.Issue.Title = "Renamed claim"
		after, err := p.path(claim.Issue)
		if err != nil || (before != after) != public {
			t.Fatalf("public=%v rename: %q -> %q err=%v", public, before, after, err)
		}
	}
}

func TestClaimEscapesUntrustedMetadata(t *testing.T) {
	claim := fakeClaim(t, false)
	claim.Trace = "javascript:alert(1)"
	claim.Snapshot.URL = "javascript:alert(2)"
	claim.Issue.State = &claimWorkflowState{Name: "<script>alert(1)</script>", Type: "started"}
	body, err := renderClaim(claim)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(body, []byte("<script>alert(1)</script>")) || bytes.Contains(body, []byte(`href="javascript:`)) {
		t.Fatal("unsafe metadata rendered")
	}
	if bytes.Count(body, []byte("</script>")) != 2 {
		t.Fatal("JSON broke out of script")
	}
	if !bytes.Contains(body, []byte(`name="robots" content="noindex"`)) {
		t.Fatal("private meta noindex missing")
	}
	start := bytes.Index(body, []byte(`<script id="claim-data" type="application/json">`)) + len(`<script id="claim-data" type="application/json">`)
	end := bytes.Index(body[start:], []byte("</script>")) + start
	var decoded completedClaim
	if err := json.Unmarshal(body[start:end], &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Issue.Description != claim.Issue.Description {
		t.Fatal("metadata changed in JSON")
	}
}

// The real published HTML must retain evidence and disclose unavailable fields
// without relying on client scripts or mistaking absent evidence for a pass.
func TestClaimReportEvidenceStates(t *testing.T) {
	for _, exit := range []int{0, 1, 2} {
		claim := fakeClaim(t, true)
		claim.Exit = exit
		claim.Issue.Description = ""
		claim.Trace = ""
		claim.Snapshot.ID, claim.Snapshot.URL = "", ""
		body, err := renderClaim(claim)
		if err != nil {
			t.Fatal(err)
		}
		for _, text := range []string{"No description supplied.", "Unavailable for this rerun", "linear-inf-6", "delivery-1", `data-status="unknown"`, fmt.Sprintf("Dagger exit %d", exit)} {
			if !bytes.Contains(body, []byte(text)) {
				t.Errorf("exit %d: missing %q", exit, text)
			}
		}
		want := "Red · Failed"
		if exit == 0 {
			want = "Green · Passed"
		}
		if !bytes.Contains(body, []byte(want)) {
			t.Errorf("exit %d: missing verdict %q", exit, want)
		}
		if bytes.Contains(body, []byte(`name="robots"`)) || bytes.Contains(body, []byte("Snapshot evidence")) || bytes.Contains(body, []byte("Open trace")) {
			t.Errorf("exit %d: public report fabricated evidence or received private metadata", exit)
		}
		if bytes.Count(body, []byte("<script")) != 2 || bytes.Contains(body, []byte("<script src=")) {
			t.Fatal("unexpected report scripts")
		}
	}
}

func TestPrivateClaimRequiresServingHeader(t *testing.T) {
	for _, status := range []int{200, 302, 403, 404} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			puts := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPut {
					puts++
				}
				w.WriteHeader(status)
			}))
			defer srv.Close()
			p := &claimPublisher{client: srv.Client(), endpoint: srv.URL, bucket: "claims", baseURL: srv.URL, urlSecret: strings.Repeat("s", 32)}
			got, err := p.publish(context.Background(), fakeClaim(t, false))
			if err == nil || got != "" || puts != 0 {
				t.Fatalf("published without noindex: URL=%s err=%v puts=%d", got, err, puts)
			}
		})
	}
}

func TestClaimPublisherConfiguration(t *testing.T) {
	for _, key := range []string{"R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CLAIM_URL_SECRET", "CLAIM_BASE_URL"} {
		t.Setenv(key, "")
	}
	var logs bytes.Buffer
	old := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(old)
	if loadClaimPublisher() != nil || !strings.Contains(logs.String(), "claim publishing off; unset: R2_ENDPOINT") {
		t.Fatalf("missing config not explained: %s", logs.String())
	}
	t.Setenv("R2_ENDPOINT", "https://account.r2.cloudflarestorage.com")
	t.Setenv("R2_BUCKET", "claims")
	t.Setenv("R2_ACCESS_KEY_ID", "key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "secret")
	t.Setenv("CLAIM_URL_SECRET", strings.Repeat("s", 32))
	if loadClaimPublisher() == nil {
		t.Fatal("valid config disabled")
	}
	t.Setenv("CLAIM_BASE_URL", "https://example.com/path")
	if loadClaimPublisher() != nil {
		t.Fatal("invalid origin accepted")
	}
}

func TestCheckDoesNotResolveOtherHostActionSecrets(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	for name, script := range map[string]string{
		"git": "#!/bin/bash\nmkdir -p \"${@: -1}\"\ntouch \"${@: -1}/.env\"\n",
		"pass-cli": `#!/bin/bash
set -eu
for name in SHIP_PUSH_PAT_REF LINEAR_API_KEY_REF DAGGER_CLOUD_TOKEN_REF; do
  if [ -n "${!name:-}" ]; then echo "unrelated reference reached resolver: $name" >&2; exit 9; fi
done
grep -q 'DAGGER_CLOUD_TOKEN=pass://infra/dagger.cloud/DAGGER_CLOUD_TOKEN' ../runtime.env
grep -qx 'REGISTEREDDELIVERY_RUN=linear-inf-6' .env
grep -qx 'REGISTEREDDELIVERY_DELIVERY=fake-delivery' ../runtime.env
! grep -q 'DELIVERY=' .env
if [ -f "$HOME/.toolbox/check.env" ]; then
  [ "$6" = --env-file ] && [ "$7" = "$HOME/.toolbox/check.env" ] && [ "$8" = -- ]
fi
echo 'https://dagger.cloud/test/traces/isolated'
`,
	} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
	}
	start := strings.Index(hostScript, "run_check() {")
	end := strings.Index(hostScript[start:], "\n}\n") + start + 3
	if err := os.MkdirAll(filepath.Join(dir, ".toolbox"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".toolbox", "check.env"), []byte("DAGGER_CLOUD_TOKEN=pass://granted-share/granted-item/DAGGER_CLOUD_TOKEN\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("bash", "-c", hostScript[start:end]+`run_check null-hype/worlds main registered-delivery linear-inf-6 "$HOME/result.json" "$HOME/dagger.log" fake-delivery`)
	cmd.Env = append(os.Environ(), "HOME="+dir, "PATH="+bin+":"+os.Getenv("PATH"), "DAGGER_CLOUD_TOKEN_REF=pass://infra/dagger.cloud/DAGGER_CLOUD_TOKEN", "SHIP_PUSH_PAT_REF=pass://infra/github.com/GITHUB_TOKEN", "LINEAR_API_KEY_REF=pass://api.linear.app/team/LINEAR_API_KEY")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("run check: %v: %s", err, out)
	}
	b, err := os.ReadFile(filepath.Join(dir, "result.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"exit": 0`) || !strings.Contains(string(b), "traces/isolated") {
		t.Fatalf("check did not reach its resolver: %s", b)
	}
}

// Run the actual host result collection with a recorded log, never Dagger or
// restic. Neither snapshot tags nor verdict-like text may override the exit.
func TestCheckCollectsSnapshotForIssueRun(t *testing.T) {
	start := strings.Index(hostScript, "  trace=$(")
	end := strings.Index(hostScript[start:], "\n  cd \"$HOME\"") + start
	if start < 0 || end < start {
		t.Fatal("result collection not found")
	}
	for _, tt := range []struct{ name, tag, want string }{
		{"matching", "linear-inf-6", strings.Repeat("a", 64)},
		{"another issue", "linear-inf-60", ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			logPath := filepath.Join(dir, "dagger.log")
			outPath := filepath.Join(dir, "result.json")
			body := "World: " + strings.Repeat("b", 64) + " (check=registered-delivery, run=linear-inf-60), restored to /world\n" + "World: " + strings.Repeat("a", 64) + " (check=registered-delivery, label=observed, run=" + tt.tag + "), restored to /world\nVerdict: this text is never truth\nhttps://dagger.cloud/test/traces/abc\n"
			if err := os.WriteFile(logPath, []byte(body), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command("bash", "-c", `set -euo pipefail; log=$1; out=$2; run=linear-inf-6; code=1; `+hostScript[start:end], "_", logPath, outPath)
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("collect: %v: %s", err, out)
			}
			b, err := os.ReadFile(outPath)
			if err != nil {
				t.Fatal(err)
			}
			var result struct {
				Exit            int
				Snapshot, Trace string
			}
			if err := json.Unmarshal(b, &result); err != nil {
				t.Fatal(err)
			}
			if result.Exit != 1 || result.Snapshot != tt.want || result.Trace != "https://dagger.cloud/test/traces/abc" {
				t.Fatalf("result=%s", b)
			}
		})
	}
}

func TestRerunPublishingCannotChangeVerdict(t *testing.T) {
	for _, tt := range []struct {
		name          string
		exit, status  int
		metadataError bool
		failDone      bool
	}{
		{"green publishes", 0, 200, false, false}, {"red publishes", 1, 200, false, false},
		{"R2 fails on green", 0, 503, false, false}, {"Linear metadata fails on green", 0, 200, true, false},
		{"Done update fails", 0, 200, false, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c, _, rec := rerunHarness(t, fmt.Sprintf(`{"job_running":false,"job_exit":0,"result":{"exit":%d,"trace":"https://dagger.cloud/test/traces/abc","snapshot":"snapshot-123","preregistration":{"file":"Predicted.pkl","source":"prediction = 0.0","findings":{"version":1,"findings":[]}}}}`, tt.exit))
			// A separate local server handles both read-only metadata and writes.
			rec.failDone = tt.failDone
			linear := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				r.Body = io.NopCloser(bytes.NewReader(body))
				if tt.metadataError && bytes.Contains(body, []byte("issue(id:")) {
					fmt.Fprint(w, `{"errors":[{"message":"unavailable"}]}`)
					return
				}
				rec.ServeHTTP(w, r)
			}))
			defer linear.Close()
			c.linear = &linearAPI{client: linear.Client(), url: linear.URL, key: "lin_api_test"}
			var uploaded completedClaim
			puts := 0
			bucket := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodHead {
					w.Header().Set("X-Robots-Tag", "noindex")
					w.WriteHeader(404)
					return
				}
				if r.Method != http.MethodPut {
					t.Errorf("unexpected method %s", r.Method)
				}
				puts++
				body, _ := io.ReadAll(r.Body)
				start := bytes.Index(body, []byte(`<script id="claim-data" type="application/json">`)) + len(`<script id="claim-data" type="application/json">`)
				end := bytes.Index(body[start:], []byte("</script>")) + start
				if err := json.Unmarshal(body[start:end], &uploaded); err != nil {
					t.Error(err)
				}
				w.WriteHeader(tt.status)
			}))
			defer bucket.Close()
			c.publisher = &claimPublisher{client: bucket.Client(), endpoint: bucket.URL, bucket: "claims", baseURL: bucket.URL, accessKey: "test", secretKey: "test", urlSecret: strings.Repeat("s", 32)}
			if err := c.rerun(context.Background(), inf6Rerun); (err != nil) != tt.failDone {
				t.Fatalf("rerun error = %v, failDone = %v", err, tt.failDone)
			}
			expectedCalls := 2
			if tt.exit == 0 {
				expectedCalls = 3
			}
			if len(rec.calls) != expectedCalls {
				t.Fatalf("verdict calls=%v", rec.calls)
			}
			if tt.exit == 0 && rec.calls[1] != "state "+infraDoneStatusID {
				t.Fatalf("publishing changed green state: %v", rec.calls)
			}
			comment := rec.calls[len(rec.calls)-1]
			if tt.metadataError || tt.status != 200 {
				if !strings.Contains(comment, "Claim page publishing failed") || strings.Contains(comment, "Claim page: ") {
					t.Fatalf("bad failure comment: %s", comment)
				}
			} else {
				if !strings.Contains(comment, "Claim page: "+bucket.URL+"/r/") {
					t.Fatalf("missing URL: %s", comment)
				}
				wantState := "In Review"
				if tt.exit == 0 && !tt.failDone {
					wantState = "Done"
				}
				xeno, _ := uploaded.Xeno.(map[string]any)
				if uploaded.Issue.State == nil || uploaded.Issue.State.Name != wantState || xeno["name"] != wantState {
					t.Fatalf("report did not capture actual completion state %q: %+v", wantState, uploaded)
				}
				if uploaded.Preregistration == nil || uploaded.Preregistration.File != "Predicted.pkl" {
					t.Fatal("controller dropped preregistration artifact")
				}
				if uploaded.Issue.Title != "The current claim" || uploaded.Exit != tt.exit || uploaded.Snapshot.ID != "snapshot-123" || uploaded.Snapshot.RunKey != "linear-inf-6" {
					t.Fatalf("wrong payload: %+v", uploaded)
				}
			}
			if tt.metadataError && puts != 0 {
				t.Fatal("uploaded without metadata")
			}
		})
	}
}

func TestRenderClaimCommand(t *testing.T) {
	claim := fakeClaim(t, false)
	input, _ := json.Marshal(claim)
	var out bytes.Buffer
	if err := runClaimCommand(context.Background(), "render-claim", bytes.NewReader(input), &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "<!doctype html>") {
		t.Fatal("no HTML")
	}
	if err := runClaimCommand(context.Background(), "render-claim", strings.NewReader(`{"exit":0}`), &out); err == nil {
		t.Fatal("accepted incomplete payload")
	}
}

// Linear's state snapshot wins over stale xeno input, while a red Dagger
// verdict remains red even if the issue snapshot says Done.
func TestClaimXenoUsesIssueStatus(t *testing.T) {
	for _, state := range []*claimWorkflowState{
		{ID: "done", Name: "Done", Type: "completed"},
		{ID: "review", Name: "Awaiting review", Type: "started"},
		nil,
	} {
		claim := fakeClaim(t, false)
		claim.Exit = 1
		claim.Issue.State = state
		claim.Xeno = map[string]string{"name": "Stale fixture status"}
		body, err := renderClaim(claim)
		if err != nil {
			t.Fatal(err)
		}
		name, kind := "Unavailable", "unknown"
		if state != nil {
			name, kind = state.Name, state.Type
		}
		for _, text := range []string{"Red · Failed", name, `data-status="` + kind + `"`} {
			if !bytes.Contains(body, []byte(text)) {
				t.Errorf("missing %q", text)
			}
		}
		if bytes.Contains(body, []byte("Stale fixture status")) {
			t.Fatal("xeno ignored authoritative issue state")
		}
	}
}
