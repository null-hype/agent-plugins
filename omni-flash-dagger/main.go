// Package main exposes a small Dagger wrapper around Gemini Omni Flash.
//
// CIT-101 is deliberately isolated from the repo's primary Dagger module:
// Omni Flash uses Gemini's Interactions API and produces video, so this spike
// can evolve without changing the existing devcontainer checks.
package main

import (
	"context"
	"encoding/json"
	"fmt"

	"dagger/omni-flash/internal/dagger"
)

const (
	defaultModel       = "gemini-omni-1.1-flash"
	defaultAspectRatio = "16:9"
	defaultResolution  = "360p"
	interactionsURL    = "https://generativelanguage.googleapis.com/v1beta/interactions"
)

type OmniFlash struct{}

type videoResponseFormat struct {
	Type        string `json:"type"`
	AspectRatio string `json:"aspect_ratio"`
	Resolution  string `json:"resolution"`
}

type interactionRequest struct {
	Model          string              `json:"model"`
	Input          string              `json:"input"`
	ResponseFormat videoResponseFormat `json:"response_format"`
}

func normalize(model, aspectRatio, resolution string) (string, string, string, error) {
	if model == "" {
		model = defaultModel
	}
	if aspectRatio == "" {
		aspectRatio = defaultAspectRatio
	}
	if resolution == "" {
		resolution = defaultResolution
	}
	if aspectRatio != "16:9" && aspectRatio != "9:16" {
		return "", "", "", fmt.Errorf("unsupported aspect ratio %q: use 16:9 or 9:16", aspectRatio)
	}
	switch resolution {
	case "360p", "720p", "1080p", "4k":
	default:
		return "", "", "", fmt.Errorf("unsupported resolution %q: use 360p, 720p, 1080p, or 4k", resolution)
	}
	return model, aspectRatio, resolution, nil
}

func requestJSON(prompt, model, aspectRatio, resolution string) ([]byte, error) {
	if prompt == "" {
		return nil, fmt.Errorf("prompt must not be empty")
	}
	model, aspectRatio, resolution, err := normalize(model, aspectRatio, resolution)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(interactionRequest{
		Model: model,
		Input: prompt,
		ResponseFormat: videoResponseFormat{
			Type:        "video",
			AspectRatio: aspectRatio,
			Resolution:  resolution,
		},
	}, "", "  ")
}

// Request shows the exact Gemini Interactions API request this module would
// submit. It is useful for cheap/offline inspection before running Generate.
func (m *OmniFlash) Request(
	prompt string,
	// +optional
	model string,
	// +optional
	aspectRatio string,
	// +optional
	resolution string,
) (string, error) {
	body, err := requestJSON(prompt, model, aspectRatio, resolution)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// Generate calls Gemini Omni Flash through the Gemini Interactions API and
// returns the generated MP4 as a Dagger File.
//
// The spike uses inline video delivery, which keeps the implementation small.
// 360p is the default to keep the first live test relatively cheap and below
// inline payload limits. Use Request first if you only want to inspect wiring.
func (m *OmniFlash) Generate(
	ctx context.Context,
	apiKey *dagger.Secret,
	prompt string,
	// +optional
	model string,
	// +optional
	aspectRatio string,
	// +optional
	resolution string,
) (*dagger.File, error) {
	body, err := requestJSON(prompt, model, aspectRatio, resolution)
	if err != nil {
		return nil, err
	}

	script := `set -eu
mkdir -p /out
curl --fail-with-body --silent --show-error \
  -X POST "$INTERACTIONS_URL" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  --data-binary @/tmp/request.json \
  > /tmp/response.json

video_b64="$(jq -r '[
  .. | objects |
  select(.type? == "video" and (.data? != null)) |
  .data
][0] // empty' /tmp/response.json)"

if [ -z "$video_b64" ]; then
  echo "Gemini returned no inline video payload:" >&2
  jq . /tmp/response.json >&2
  exit 1
fi

printf '%s' "$video_b64" | base64 -d > /out/omni-flash.mp4
test -s /out/omni-flash.mp4
`

	ctr := dag.Container().
		From("alpine:3.22").
		WithExec([]string{"apk", "add", "--no-cache", "curl", "jq"}).
		WithSecretVariable("GEMINI_API_KEY", apiKey).
		WithEnvVariable("INTERACTIONS_URL", interactionsURL).
		WithNewFile("/tmp/request.json", string(body)).
		WithExec([]string{"sh", "-c", script})

	// Force the network/API step now so a failed interaction is surfaced as
	// Generate's error rather than later during export.
	if _, err := ctr.File("/out/omni-flash.mp4").Size(ctx); err != nil {
		return nil, err
	}
	return ctr.File("/out/omni-flash.mp4"), nil
}

// Check is an offline module check. It verifies the stable Omni model ID,
// defaults, request shape, and validation without spending video-generation
// quota or requiring a secret.
//
// +check
func (m *OmniFlash) Check(ctx context.Context) error {
	body, err := requestJSON("A paper boat crossing a puddle.", "", "", "")
	if err != nil {
		return err
	}
	var req interactionRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return err
	}
	if req.Model != defaultModel {
		return fmt.Errorf("model default drifted: %s", req.Model)
	}
	if req.ResponseFormat.Type != "video" ||
		req.ResponseFormat.AspectRatio != defaultAspectRatio ||
		req.ResponseFormat.Resolution != defaultResolution {
		return fmt.Errorf("unexpected response_format: %+v", req.ResponseFormat)
	}
	if _, _, _, err := normalize("", "1:1", "360p"); err == nil {
		return fmt.Errorf("invalid aspect ratio unexpectedly accepted")
	}
	if _, _, _, err := normalize("", "16:9", "8k"); err == nil {
		return fmt.Errorf("invalid resolution unexpectedly accepted")
	}

	// Keep ctx in the signature so Dagger exposes this as a normal check and
	// future live/probe work can use it without changing the API.
	_ = ctx
	return nil
}
