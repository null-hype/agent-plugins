#!/usr/bin/env bash
# toolbox-lifecycle: the host's own idle shutdown and runtime lease (CIT-466).
# host-startup.sh installs it as /usr/local/bin/toolbox-lifecycle, runs
# `boot` once per boot, and runs `tick` every minute from a systemd timer, so
# the host stops itself without any agent or LLM deciding to.
#
#   boot    marks jobs the last boot left unfinished as interrupted and
#           clears their pid files (a pid from the old boot can be reused),
#           then starts this boot's idle clock and lease.
#   tick    looks for productive work; stops the host when it has been idle
#           for LIFECYCLE_IDLE_MIN, when the lease has ended with no work, or
#           at the hard cap whatever is running.
#   status  prints the clocks as JSON, for host_status.
#
# Productive work is a running toolbox job (workspace up, ship, review; a
# review ends with the restic backup), the Linear agent working an issue
# (its claude-agent-sdk process, visible from the host), or a restic or codex
# process. A poll, an SSH session or a tool call starts none of those, so it
# does not keep the host up.
#
# The lease starts at LIFECYCLE_LEASE_MIN. A tick with work in progress at or
# after the deadline moves it LIFECYCLE_EXTEND_MIN later, never past the hard
# cap of LIFECYCLE_MAX_MIN after boot. At the hard cap the host stops even
# mid-job: the job is recorded as interrupted at the next boot, and ship is
# idempotent while review skips a head it already reviewed.
#
# Before powering off it stops each running workspace with `devpod stop`,
# which keeps its files; the persistent disk keeps everything else, jobs'
# logs and results included.
set -euo pipefail

STATE=${LIFECYCLE_STATE_DIR:-/var/lib/toolbox-lifecycle}
JOBS=${LIFECYCLE_JOBS_DIR:-/home/toolbox/.toolbox/jobs}
TOOLBOX_USER=${LIFECYCLE_USER:-toolbox}
IDLE_MIN=${LIFECYCLE_IDLE_MIN:-15}
LEASE_MIN=${LIFECYCLE_LEASE_MIN:-120}
EXTEND_MIN=${LIFECYCLE_EXTEND_MIN:-15}
MAX_MIN=${LIFECYCLE_MAX_MIN:-240}
mkdir -p "$STATE"

now() { echo "${LIFECYCLE_NOW:-$(date +%s)}"; }
log() { echo "$(date -u -d "@$(now)" +%FT%TZ) $*" >> "$STATE/log"; }
get() { cat "$STATE/$1" 2>/dev/null || echo 0; }

# Ids of toolbox jobs whose process is alive.
running_jobs() {
  local f pid
  for f in "$JOBS"/*.pid; do
    [ -f "$f" ] || continue
    pid=$(cat "$f")
    kill -0 "$pid" 2>/dev/null && basename "$f" .pid
  done
  return 0
}

# Why the host is busy, one reason per line; nothing when idle.
activity() {
  local j
  for j in $(running_jobs); do echo "job:$j"; done
  pgrep -f claude-agent-sdk >/dev/null 2>&1 && echo "agent"
  pgrep -x restic >/dev/null 2>&1 && echo "restic"
  pgrep -x codex >/dev/null 2>&1 && echo "codex"
  return 0
}

boot() {
  local f id t
  t=$(now)
  for f in "$JOBS"/*.pid; do
    [ -f "$f" ] || continue
    id=$(basename "$f" .pid)
    if [ ! -f "$JOBS/$id.exit" ]; then
      # 130: did not finish. The marker says why, for workspace_status and
      # the duplicate checks.
      echo 130 > "$JOBS/$id.exit"
      echo "interrupted by host shutdown before $(date -u -d "@$t" +%FT%TZ)" > "$JOBS/$id.interrupted"
      log "boot: job $id was interrupted"
    fi
    rm -f "$f"
  done
  # Workspaces do not survive a reboot running, so last boot's `up` results
  # no longer say the agent is up: host_wake has to start it again. Ship and
  # review results stay; their status tools still report them.
  for f in "$JOBS"/*.exit; do
    [ -f "$f" ] || continue
    id=$(basename "$f" .exit)
    case $id in ship | review-*) ;; *) mv -f "$f" "$JOBS/$id.exit.lastboot" ;; esac
  done
  echo "$t" > "$STATE/boot"
  echo "$t" > "$STATE/last-active"
  echo $((t + LEASE_MIN * 60)) > "$STATE/deadline"
  echo 0 > "$STATE/extensions"
  log "boot: lease until $(date -u -d "@$((t + LEASE_MIN * 60))" +%FT%TZ), hard cap $((MAX_MIN)) min"
}

shutdown_host() {
  local reason=$1 ws
  log "stop: $reason"
  echo "$reason" > "$STATE/last-stop"
  # Running workspaces are stopped, not deleted, so their files stay.
  for ws in $(su - "$TOOLBOX_USER" -c 'devpod list --output json' 2>/dev/null | jq -r '.[]?.id'); do
    timeout 120 su - "$TOOLBOX_USER" -c "devpod stop $ws" >> "$STATE/log" 2>&1 ||
      log "stop: devpod stop $ws failed; powering off anyway"
  done
  ${LIFECYCLE_POWEROFF:-systemctl poweroff}
}

tick() {
  local t boot last deadline ext cap busy
  t=$(now)
  [ -f "$STATE/boot" ] || boot
  boot=$(get boot) last=$(get last-active) deadline=$(get deadline) ext=$(get extensions)
  cap=$((boot + MAX_MIN * 60))
  busy=$(activity | paste -sd, -)
  if [ -n "$busy" ]; then
    last=$t
    echo "$t" > "$STATE/last-active"
    if [ "$t" -ge "$deadline" ] && [ "$deadline" -lt "$cap" ]; then
      deadline=$((deadline + EXTEND_MIN * 60))
      [ "$deadline" -le "$cap" ] || deadline=$cap
      echo "$deadline" > "$STATE/deadline"
      echo $((ext + 1)) > "$STATE/extensions"
      log "lease extended to $(date -u -d "@$deadline" +%FT%TZ) for $busy"
    fi
  fi
  if [ "$t" -ge "$cap" ]; then
    shutdown_host "hard cap of $MAX_MIN min reached${busy:+ with $busy still running}"
  elif [ -z "$busy" ] && [ "$t" -ge "$deadline" ]; then
    shutdown_host "lease ended with no work in progress"
  elif [ -z "$busy" ] && [ $((t - last)) -ge $((IDLE_MIN * 60)) ]; then
    shutdown_host "idle for $(((t - last) / 60)) min"
  fi
  return 0
}

status() {
  local t boot last
  t=$(now)
  boot=$(get boot) last=$(get last-active)
  activity | jq -R . | jq -s --argjson now "$t" --argjson boot "$boot" --argjson last "$last" \
    --argjson deadline "$(get deadline)" --argjson extensions "$(get extensions)" \
    --argjson idle_min "$IDLE_MIN" --argjson cap "$((boot + MAX_MIN * 60))" \
    --arg last_stop "$(cat "$STATE/last-stop" 2>/dev/null || true)" \
    '{busy: ., idle_seconds: ($now - $last), idle_limit_seconds: ($idle_min * 60),
      lease_seconds_left: ($deadline - $now), hard_cap_seconds_left: ($cap - $now),
      extensions: $extensions, last_stop: $last_stop}'
}

case ${1:-} in
boot) boot ;;
tick) tick ;;
status) status ;;
*) echo "usage: toolbox-lifecycle boot|tick|status" >&2; exit 2 ;;
esac
