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

	// Vertex AI (Gemini Enterprise Agent Platform) image path. This bills
	// against the given GCP project's own billing account/credit balance
	// via IAM auth, unlike Generate above which bills the AI Studio API
	// key directly. Use this first to prove credit-backed billing before
	// touching the (much more expensive) video path.
	defaultImageModel    = "imagen-4.0-fast-generate-001"
	defaultLocation      = "us-central1"
	defaultImageCount    = 1
	vertexPredictURLTmpl = "https://%s-aiplatform.googleapis.com/v1/projects/%s/locations/%s/publishers/google/models/%s:predict"
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
	if _, err := ctr.Stdout(ctx); err != nil {
		return nil, err
	}
	return ctr.File("/out/omni-flash.mp4"), nil
}

type imagePredictInstance struct {
	Prompt string `json:"prompt"`
}

type imagePredictParameters struct {
	SampleCount int `json:"sampleCount"`
}

type imagePredictRequest struct {
	Instances  []imagePredictInstance  `json:"instances"`
	Parameters imagePredictParameters `json:"parameters"`
}

func normalizeImage(model, location string, sampleCount int) (string, string, int, error) {
	if model == "" {
		model = defaultImageModel
	}
	if location == "" {
		location = defaultLocation
	}
	if sampleCount == 0 {
		sampleCount = defaultImageCount
	}
	if sampleCount < 1 || sampleCount > 4 {
		return "", "", 0, fmt.Errorf("unsupported sample count %d: use 1-4", sampleCount)
	}
	return model, location, sampleCount, nil
}

func imagePredictURL(project, model, location string) string {
	return fmt.Sprintf(vertexPredictURLTmpl, location, project, location, model)
}

func imageRequestJSON(prompt, model, location string, sampleCount int) ([]byte, error) {
	if prompt == "" {
		return nil, fmt.Errorf("prompt must not be empty")
	}
	model, location, sampleCount, err := normalizeImage(model, location, sampleCount)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(imagePredictRequest{
		Instances:  []imagePredictInstance{{Prompt: prompt}},
		Parameters: imagePredictParameters{SampleCount: sampleCount},
	}, "", "  ")
}

// ImageRequest shows the exact Vertex AI Imagen predict request this module
// would submit, along with the endpoint URL it would target. Useful for
// cheap/offline inspection before running GenerateImage.
func (m *OmniFlash) ImageRequest(
	project string,
	// +optional
	model string,
	// +optional
	location string,
	prompt string,
	// +optional
	sampleCount int,
) (string, error) {
	body, err := imageRequestJSON(prompt, model, location, sampleCount)
	if err != nil {
		return "", err
	}
	resolvedModel, resolvedLocation, _, err := normalizeImage(model, location, sampleCount)
	if err != nil {
		return "", err
	}
	url := imagePredictURL(project, resolvedModel, resolvedLocation)
	return fmt.Sprintf("%s\n\n%s\n", url, body), nil
}

// GenerateImage calls Vertex AI's Imagen predict endpoint (Gemini Enterprise
// Agent Platform) and returns the generated PNG as a Dagger File.
//
// This bills the given GCP project's own billing account/credit balance via
// IAM auth (a service-account key exchanged for an access token), which is
// the credit-backed path — distinct from Generate above, which bills the AI
// Studio API key directly. Prefer proving this path works before spending on
// the (much more expensive) video path.
func (m *OmniFlash) GenerateImage(
	ctx context.Context,
	// Service-account JSON key with the Vertex AI User role on project.
	credentials *dagger.Secret,
	project string,
	prompt string,
	// +optional
	model string,
	// +optional
	location string,
	// +optional
	sampleCount int,
) (*dagger.File, error) {
	body, err := imageRequestJSON(prompt, model, location, sampleCount)
	if err != nil {
		return nil, err
	}
	resolvedModel, resolvedLocation, _, err := normalizeImage(model, location, sampleCount)
	if err != nil {
		return nil, err
	}
	url := imagePredictURL(project, resolvedModel, resolvedLocation)

	script := `set -eu
mkdir -p /out
gcloud auth activate-service-account --key-file=/tmp/credentials.json >/dev/null
token="$(gcloud auth print-access-token)"

curl --fail-with-body --silent --show-error \
  -X POST "$PREDICT_URL" \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/request.json \
  > /tmp/response.json

image_b64="$(jq -r '.predictions[0].bytesBase64Encoded // empty' /tmp/response.json)"

if [ -z "$image_b64" ]; then
  echo "Vertex AI returned no image payload:" >&2
  jq . /tmp/response.json >&2
  exit 1
fi

printf '%s' "$image_b64" | base64 -d > /out/omni-image.png
test -s /out/omni-image.png
`

	ctr := dag.Container().
		From("google/cloud-sdk:slim").
		WithSecretVariable("GOOGLE_CREDENTIALS_JSON", credentials).
		WithExec([]string{"sh", "-c", "printf '%s' \"$GOOGLE_CREDENTIALS_JSON\" > /tmp/credentials.json"}).
		WithEnvVariable("PREDICT_URL", url).
		WithNewFile("/tmp/request.json", string(body)).
		WithExec([]string{"sh", "-c", script})

	// Force the network/API step now so a failed prediction is surfaced as
	// GenerateImage's error rather than later during export.
	if _, err := ctr.Stdout(ctx); err != nil {
		return nil, err
	}
	return ctr.File("/out/omni-image.png"), nil
}

// CheckImage is an offline module check for the Vertex AI Imagen path. It
// verifies defaults, endpoint construction, and validation without spending
// quota or requiring credentials.
//
// +check
func (m *OmniFlash) CheckImage(ctx context.Context) error {
	body, err := imageRequestJSON("A paper boat crossing a puddle.", "", "", 0)
	if err != nil {
		return err
	}
	var req imagePredictRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return err
	}
	if len(req.Instances) != 1 || req.Instances[0].Prompt == "" {
		return fmt.Errorf("unexpected instances: %+v", req.Instances)
	}
	if req.Parameters.SampleCount != defaultImageCount {
		return fmt.Errorf("sampleCount default drifted: %d", req.Parameters.SampleCount)
	}
	url := imagePredictURL("my-project", defaultImageModel, defaultLocation)
	want := fmt.Sprintf("https://%s-aiplatform.googleapis.com/v1/projects/my-project/locations/%s/publishers/google/models/%s:predict",
		defaultLocation, defaultLocation, defaultImageModel)
	if url != want {
		return fmt.Errorf("unexpected predict URL: %s", url)
	}
	if _, _, _, err := normalizeImage("", "", 0); err != nil {
		return fmt.Errorf("defaults unexpectedly rejected: %w", err)
	}
	if _, _, _, err := normalizeImage("", "", 5); err == nil {
		return fmt.Errorf("invalid sample count unexpectedly accepted")
	}

	_ = ctx
	return nil
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
