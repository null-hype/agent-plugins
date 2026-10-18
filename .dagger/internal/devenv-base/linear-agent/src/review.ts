import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * A Codex review of a repo's HEAD, run through the codex-session feature's
 * bin (src/codex-session). Not wired into a turn yet: the review is to run
 * in the session's codespace after Claude commits (see codespace.ts). The bin
 * restores the stored Codex login from restic, reviews, and backs the
 * session -- login and review transcript -- up again.
 */
export interface ReviewOutput {
  findings: { title: string; body: string; code_location: { absolute_file_path: string; line_range: { start: number; end: number } } }[];
  overall_correctness: string;
  overall_explanation: string;
  overall_confidence_score: number;
}

export interface SessionReview {
  review: ReviewOutput;
  thread: string;
  snapshot: string;
}

export async function codexReview(dir: string): Promise<SessionReview> {
  const { stdout } = await run("codex-session", ["review", dir, "--commit", "HEAD"], {
    maxBuffer: 16 * 1024 * 1024,
    timeout: Number(process.env.CODEX_REVIEW_TIMEOUT ?? 900) * 1000,
  });
  return JSON.parse(stdout) as SessionReview;
}

/** The Linear response body: verdict, findings, and where the session went. */
export function formatReview({ review, thread, snapshot }: SessionReview, dir: string): string {
  const findings = review.findings.map((f) => {
    const file = f.code_location.absolute_file_path.replace(`${dir.replace(/\/$/, "")}/`, "");
    const { start, end } = f.code_location.line_range;
    return `### ${f.title}\n\n${f.body}\n\n\`${file}:${start}-${end}\``;
  });
  return [
    `**Codex review**: ${review.overall_correctness} (confidence ${review.overall_confidence_score})`,
    review.overall_explanation,
    ...findings,
    `Codex session ${thread}, backed up as restic snapshot ${snapshot}.`,
  ].join("\n\n");
}
