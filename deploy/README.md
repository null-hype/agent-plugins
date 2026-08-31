# Render deploy blueprints

Render Blueprints for services deployed from images this repo's Dagger
module builds and publishes (`.dagger/main.go`).

- `render.yaml` -- the `devpod-keepalive` Cron Job. Runs the image published
  by `PublishKeepalive` (`ghcr.io/null-hype/devenv-keepalive`) on Render's
  schedule; `TriggerRenderCron` can also kick a run on demand. Ported from
  `devenv-base/render.yaml` (JIN-106).
