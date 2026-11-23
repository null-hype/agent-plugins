"""Render Workflow service exposing the thread replay as one task."""
import json

from render import Retry, TaskContext, Workflows

from replay import SNAPSHOT, run_replay

app = Workflows()


@app.task(plan="starter", timeout_seconds=300, retry=Retry(max_retries=0, wait_duration_ms=1000))
def replay_thread(ctx: TaskContext, snapshot: str = SNAPSHOT) -> dict:
    result = run_replay(snapshot)
    result["executor"] = "workflow"
    result["render_run_id"] = ctx.metadata.task_run_id
    print("THREAD_REPLAY_RECORD " + json.dumps(result, sort_keys=True), flush=True)
    if result["verdict"] != "pass":
        raise RuntimeError("thread replay failed: " + json.dumps(result["checks"], sort_keys=True))
    return result


if __name__ == "__main__":
    app.start()
