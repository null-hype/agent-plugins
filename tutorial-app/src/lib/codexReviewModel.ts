import type { InvestigationDocument, InvestigationModel, Marker, Severity } from './investigationModel';

// A `codex review` run, as codex-review-sync.sh reads it from a rollout
// transcript: session_meta's id/cwd/git and the ExitedReviewMode item's
// review_output. The same record becomes a GitHub PR review there; here it
// becomes the editor-agnostic model InvestigationVault's Monaco adapter
// renders, one document per reviewed file with each finding as a marker.

export type CodexFinding = {
  title: string;
  body: string;
  confidence_score: number;
  /** 0 is most severe, as Codex's [P0]..[P3] titles say. */
  priority: number;
  code_location: { absolute_file_path: string; line_range: { start: number; end: number } };
};

export type CodexReview = {
  session: string;
  cwd: string;
  git: { commit_hash: string; branch: string; repository_url: string };
  review: {
    findings: CodexFinding[];
    overall_correctness: string;
    overall_explanation: string;
    overall_confidence_score: number;
  };
};

const severityOf = (priority: number): Severity => (priority <= 1 ? 'error' : priority === 2 ? 'warning' : 'info');

/** The max column of a 1-based line, matching a Monaco model (line length + 1). */
const maxColumn = (text: string, line: number) => (text.split('\n')[line - 1]?.length ?? 0) + 1;

/**
 * `files` holds each reviewed file's text at the reviewed commit, keyed by its
 * path relative to the review's cwd -- Codex's line numbers refer to that
 * revision, not to whatever the branch holds now.
 */
export function buildCodexReviewModel({ cwd, git, review }: CodexReview, files: Record<string, string>): InvestigationModel {
  const verdict = `codex review ${git.commit_hash.slice(0, 7)}: ${review.overall_correctness} (${review.overall_confidence_score})`;
  const byPath = new Map<string, CodexFinding[]>();
  for (const f of review.findings) {
    const path = f.code_location.absolute_file_path.replace(cwd + '/', '');
    byPath.set(path, [...(byPath.get(path) ?? []), f]);
  }

  const documents = [...byPath].map(([path, findings]): InvestigationDocument => {
    const text = files[path];
    if (text === undefined) throw new Error(`no text for reviewed file ${path}`);
    const markers = findings.map(({ title, body, priority, code_location: { line_range } }): Marker => ({
      severity: severityOf(priority),
      message: `${title}\n\n${body}`,
      line: line_range.start,
      column: 1,
      endLine: line_range.end,
      endColumn: maxColumn(text, line_range.end),
    }));
    return {
      id: 'git://' + git.commit_hash + '/' + path,
      uri: { scheme: 'git', authority: git.commit_hash.slice(0, 7), path: '/' + path },
      text,
      trail: [verdict, path],
      markers,
      lenses: findings.map((f) => ({ line: f.code_location.line_range.start, title: f.title })),
      definitions: [],
    };
  });
  if (!documents.length) throw new Error(`${verdict}: no findings to show`);
  return { documents, homeId: documents[0].id, start: documents[0].trail };
}
