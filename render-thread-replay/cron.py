"""Scheduled entry point.

With RENDER_API_KEY set, starts the replay as a Workflow run and records that
run. Without it, replays inside this cron instance and records
workflow_dispatch=not_configured, so the log never presents a cron-instance
replay as a Workflow run.
"""
import json
import os
import sys

from replay import SNAPSHOT, now, run_replay

TASK = os.environ.get("REPLAY_TASK", "thread-replay-workflow/replay_thread")


def main():
    fired_at = now()
    cron = {
        "cron_fired_at": fired_at,
        "cron_service_id": os.environ.get("RENDER_SERVICE_ID"),
        "cron_instance_id": os.environ.get("RENDER_INSTANCE_ID"),
    }
    if os.environ.get("RENDER_API_KEY"):
        from render import Render

        run = Render().workflows.run_task(TASK, [SNAPSHOT])
        status = str(getattr(run, "status", ""))
        result = run.results[0] if isinstance(run.results, list) and run.results else run.results
        record = dict(result) if isinstance(result, dict) else {"verdict": "fail"}
        record.update(cron, workflow_dispatch="started", render_run_id=run.id, workflow_status=status)
        if "succeeded" not in status.lower() and "completed" not in status.lower():
            record["verdict"] = "fail"
    else:
        record = run_replay()
        record.update(cron, executor="cron-instance", workflow_dispatch="not_configured",
                      render_run_id=None)
    record["cron_finished_at"] = now()
    print("THREAD_REPLAY_RECORD " + json.dumps(record, sort_keys=True), flush=True)
    return 0 if record["verdict"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
