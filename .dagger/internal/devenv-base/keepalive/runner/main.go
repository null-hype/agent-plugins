package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	devcmd "github.com/loft-sh/devpod/cmd"
	"github.com/loft-sh/devpod/pkg/client"
)

type workspace interface {
	Up(context.Context) error
	Status(context.Context) (client.Status, error)
	Probe(context.Context) error
	RefreshActivity(context.Context) error
}

func keepAlive(ctx context.Context, w workspace) error {
	// Up reconciles both the machine and its devcontainer. Machine status
	// alone cannot tell us whether the container needs to be started.
	log.Print("keepalive: ensuring devcontainer is running")
	if err := w.Up(ctx); err != nil {
		return fmt.Errorf("ensure devcontainer running: %w", err)
	}
	status, err := w.Status(ctx)
	if err != nil {
		return fmt.Errorf("read devcontainer status: %w", err)
	}
	if status != client.StatusRunning {
		return fmt.Errorf("devcontainer status is %s, expected Running", status)
	}
	if err := w.Probe(ctx); err != nil {
		return fmt.Errorf("execute devcontainer probe: %w", err)
	}
	// Use the same agent operation as DevPod's periodic tunnel refresh,
	// but await its result instead of relying on a background log message.
	if err := w.RefreshActivity(ctx); err != nil {
		return fmt.Errorf("refresh inactivity watchdog: %w", err)
	}
	return nil
}

func main() {
	// DevPod can upload os.Executable() as the remote agent when downloading
	// an agent is unavailable. Preserve the official agent/helper commands
	// in this binary so that upstream fallback remains functional.
	if len(os.Args) < 2 || os.Args[1] != "keepalive" {
		devcmd.Execute()
		return
	}
	args := flag.NewFlagSet("devpod-keepalive keepalive", flag.ExitOnError)
	id := args.String("workspace", "devenv-base-gce", "Existing workspace ID")
	timeout := args.Duration("timeout", 25*time.Minute, "Workspace operation deadline")
	if err := args.Parse(os.Args[2:]); err != nil {
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, *timeout)
	defer cancel()
	w, err := loadWorkspace(ctx, *id)
	if err == nil {
		err = keepAlive(ctx, w)
	}
	if err != nil {
		log.Printf("keepalive: FAILED: %v", err)
		os.Exit(1)
	}
	log.Printf("keepalive: OK workspace=%s devcontainer=Running activity=refreshed", *id)
}
