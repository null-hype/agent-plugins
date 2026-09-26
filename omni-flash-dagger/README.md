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

## Scope / next step

This first pass targets the direct **Gemini API** with an API key because it is
the smallest executable proof of the Dagger↔Omni boundary.

It does **not** yet route through Gemini Enterprise Agent Platform / Vertex
managed-agent infrastructure. If CIT-101's original goal was specifically to
consume Agent Platform promotional credit, that should be a second adapter
behind the same Dagger interface rather than conflated with this direct API
probe.

The spike also uses inline video delivery. Google's docs recommend URI delivery
for larger outputs; add that before treating 1080p/4K generation as a normal
path.
