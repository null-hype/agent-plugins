# CIT-101 — Omni Flash Dagger spike

Standalone Dagger module for generating a video with **Gemini Omni Flash**.

The stable Gemini API model is `gemini-omni-1.1-flash`. Omni uses Gemini's
**Interactions API** rather than the legacy `generateContent` endpoint and
returns video output.

## Why this is isolated

This is a spike, so it lives in `omni-flash-dagger/` rather than the repo's
root Dagger module. That keeps an experimental, quota-consuming media API out
of normal CI.

The `+check` is intentionally offline. It validates the model ID, request
shape, defaults and argument validation without making a paid generation call.

## Inspect the request

```sh
dagger call -m ./omni-flash-dagger request \
  --prompt "A tiny sailboat crossing Sydney Harbour at dawn."
```

Defaults:

- model: `gemini-omni-1.1-flash`
- aspect ratio: `16:9`
- resolution: `360p` (cheap/small first probe)

## Run the offline check

```sh
dagger check -m ./omni-flash-dagger
```

## Generate a real video

```sh
export GEMINI_API_KEY=...
dagger call -m ./omni-flash-dagger generate \
  --api-key=env:GEMINI_API_KEY \
  --prompt "A marble rolling through a wooden chain-reaction machine, one continuous cinematic shot." \
  export --path=omni-flash.mp4
```

Optional flags:

```text
--model=gemini-omni-1.1-flash
--aspect-ratio=9:16
--resolution=720p
```

Supported resolutions in this spike are `360p`, `720p`, `1080p`, and
`4k`.

## Credits vs. billing: two separate paths

`Generate` above bills the AI Studio API key's own billing account directly —
it does **not** draw on Vertex AI / Gemini Enterprise Agent Platform
promotional credit. If the goal is to consume credit tied to a GCP project
rather than pay per call, use the Vertex AI Imagen path instead:

```sh
dagger call -m ./omni-flash-dagger image-request \
  --project my-gcp-project \
  --prompt "A tiny sailboat crossing Sydney Harbour at dawn."
```

Defaults:

- model: `imagen-4.0-fast-generate-001` (cheap/fast for a first probe)
- location: `us-central1`
- sample count: `1`

Generate a real image against the given project's own billing/credit balance
(auth is a service-account key with the Vertex AI User role, exchanged for an
access token via `gcloud`, not an API key):

```sh
dagger call -m ./omni-flash-dagger generate-image \
  --credentials=file:./service-account.json \
  --project my-gcp-project \
  --prompt "A tiny sailboat crossing Sydney Harbour at dawn." \
  export --path=omni-image.png
```

`dagger check` includes an offline `check-image` alongside `check`, so both
paths' defaults/request shape/URL construction are validated without spending
quota.

## Scope / next step

Image generation via Vertex AI Imagen (above) is the recommended first live
probe for proving credit-backed billing, since it's far cheaper than video.

Video generation still only has the direct **Gemini API** path (`Generate`)
implemented, which bills the API key directly rather than a project's credit
balance. If credit-backed *video* is needed, that's a further adapter against
Omni Flash on Vertex AI/Gemini Enterprise Agent Platform (model ID
`gemini-omni-1.1-flash-preview` there, not the bare Gemini API name) — not yet
built here.

The video path also uses inline delivery. Google's docs recommend URI delivery
for larger outputs; add that before treating 1080p/4K generation as a normal
path.
