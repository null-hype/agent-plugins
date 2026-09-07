package main

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/loft-sh/devpod/pkg/client"
)

type fakeWorkspace struct {
	status client.Status
	fail   string
	err    error
	calls  []string
}

func (w *fakeWorkspace) call(step string) error {
	w.calls = append(w.calls, step)
	if w.fail == step {
		return w.err
	}
	return nil
}
func (w *fakeWorkspace) Up(context.Context) error { return w.call("up") }
func (w *fakeWorkspace) Status(context.Context) (client.Status, error) {
	return w.status, w.call("status")
}
func (w *fakeWorkspace) Probe(context.Context) error           { return w.call("probe") }
func (w *fakeWorkspace) RefreshActivity(context.Context) error { return w.call("refresh") }

func TestKeepAlive(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status client.Status
		fail   string
		want   []string
	}{
		{"running container", client.StatusRunning, "", []string{"up", "status", "probe", "refresh"}},
		{"start failed", client.StatusRunning, "up", []string{"up"}},
		{"status failed", client.StatusRunning, "status", []string{"up", "status"}},
		{"VM running container stopped", client.StatusStopped, "", []string{"up", "status"}},
		{"container absent", client.StatusNotFound, "", []string{"up", "status"}},
		{"container busy", client.StatusBusy, "", []string{"up", "status"}},
		{"SSH failed", client.StatusRunning, "probe", []string{"up", "status", "probe"}},
		{"watchdog update failed", client.StatusRunning, "refresh", []string{"up", "status", "probe", "refresh"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cause := errors.New("operation failed")
			w := &fakeWorkspace{status: tc.status, fail: tc.fail, err: cause}
			err := keepAlive(context.Background(), w)
			wantError := tc.fail != "" || tc.status != client.StatusRunning
			if (err != nil) != wantError {
				t.Fatalf("error = %v, want error %v", err, wantError)
			}
			if tc.fail != "" && !errors.Is(err, cause) {
				t.Fatalf("lost original error: %v", err)
			}
			if !reflect.DeepEqual(w.calls, tc.want) {
				t.Fatalf("operations %v, want %v", w.calls, tc.want)
			}
		})
	}
}
