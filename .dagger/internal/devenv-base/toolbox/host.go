package main

import (
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

//go:embed host.sh
var hostScript string

// hostAPI runs one host.sh action and returns its JSON output. env is
// exported before the script runs; it carries secrets, so it travels on
// stdin, never in a command line.
type hostAPI interface {
	Run(ctx context.Context, env map[string]string, args ...string) ([]byte, error)
}

// sshHost runs host.sh on the host VM over SSH. The VM's address and host
// keys come from the Compute API on every call, because its IP changes each
// time it starts.
type sshHost struct {
	gce    computeAPI
	user   string
	signer ssh.Signer
}

func (h *sshHost) Run(ctx context.Context, env map[string]string, args ...string) ([]byte, error) {
	in, err := h.gce.Instance(ctx)
	if err != nil {
		return nil, err
	}
	if in.Status != "RUNNING" || in.IP == "" {
		return nil, fmt.Errorf("the host is %s; call host_start, then host_status until it is ready", in.Status)
	}
	keys, err := h.gce.HostKeys(ctx)
	if err != nil || len(keys) == 0 {
		return nil, fmt.Errorf("the host has not published its SSH host keys yet; it is probably still booting (%v)", err)
	}

	cfg := &ssh.ClientConfig{
		User:            h.user,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(h.signer)},
		HostKeyCallback: pinnedHostKeys(keys),
		Timeout:         15 * time.Second,
	}
	addr := net.JoinHostPort(in.IP, "22")
	conn, err := (&net.Dialer{Timeout: cfg.Timeout}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("the host is RUNNING but SSH is not reachable yet: %w", err)
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("ssh: %w", err)
	}
	client := ssh.NewClient(c, chans, reqs)
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	defer sess.Close()
	var stdout, stderr bytes.Buffer
	sess.Stdin = strings.NewReader(exports(env) + hostScript)
	sess.Stdout, sess.Stderr = &stdout, &stderr

	done := make(chan error, 1)
	go func() { done <- sess.Run(hostCommand(args)) }()
	select {
	case <-ctx.Done():
		client.Close()
		return nil, ctx.Err()
	case err = <-done:
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %v: %s", args[0], err, lastLines(stderr.String(), 20))
	}
	return stdout.Bytes(), nil
}

func pinnedHostKeys(keys []ssh.PublicKey) ssh.HostKeyCallback {
	return func(_ string, _ net.Addr, got ssh.PublicKey) error {
		for _, k := range keys {
			if bytes.Equal(k.Marshal(), got.Marshal()) {
				return nil
			}
		}
		return fmt.Errorf("host key %s is not one the VM published", ssh.FingerprintSHA256(got))
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func hostCommand(args []string) string {
	q := make([]string, len(args))
	for i, a := range args {
		q[i] = shellQuote(a)
	}
	return "bash -s -- " + strings.Join(q, " ")
}

func exports(env map[string]string) string {
	names := make([]string, 0, len(env))
	for k := range env {
		names = append(names, k)
	}
	sort.Strings(names)
	var b strings.Builder
	for _, k := range names {
		fmt.Fprintf(&b, "export %s=%s\n", k, shellQuote(env[k]))
	}
	return b.String()
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
