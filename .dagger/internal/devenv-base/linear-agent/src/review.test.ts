import { test } from "node:test";
import assert from "node:assert/strict";
import { formatReview } from "./review.ts";

test("formatReview lists the verdict, each finding relative to the repo, and the snapshot", () => {
  const body = formatReview(
    {
      review: {
        overall_correctness: "patch is incorrect",
        overall_explanation: "The script exits early.",
        overall_confidence_score: 0.8,
        findings: [
          {
            title: "[P2] Exit status is lost",
            body: "`|| true` swallows the failure.",
            code_location: { absolute_file_path: "/work/repo/scripts/x.sh", line_range: { start: 3, end: 4 } },
          },
        ],
      },
      thread: "thread-1",
      snapshot: "abc123",
    },
    "/work/repo/",
  );
  assert.match(body, /^\*\*Codex review\*\*: patch is incorrect \(confidence 0.8\)/);
  assert.match(body, /### \[P2\] Exit status is lost/);
  assert.match(body, /`scripts\/x\.sh:3-4`/);
  assert.match(body, /restic snapshot abc123/);
});
