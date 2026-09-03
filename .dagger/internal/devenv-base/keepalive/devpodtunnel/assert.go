package devpodtunnel

import "dagger/devenv-base/keepalive/core"

// Compile-time assertion that Tunnel satisfies core.Tunnel.
var _ core.Tunnel = (*Tunnel)(nil)
