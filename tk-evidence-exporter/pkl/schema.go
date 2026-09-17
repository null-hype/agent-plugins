// Package schema embeds Evidence.pkl so internal/export can materialize it
// alongside a generated instance module without depending on the caller's
// working directory or repo layout at runtime.
package schema

import _ "embed"

//go:embed Evidence.pkl
var EvidencePkl []byte
