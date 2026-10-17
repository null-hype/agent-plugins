import { describe, expect, it } from 'vitest';
import { buildCodexReviewModel, type CodexReview } from './codexReviewModel';
import review from '../../evidence/codex-review-pr211-v1/review.json';
import script from '../../evidence/codex-review-pr211-v1/codex-review-sync.sh?raw';

// The recorded PR #211 review, computed with no Monaco: which file, which
// lines, which severity.

const PATH = '.dagger/internal/devenv-base/hk/codex-review-sync.sh';
const record = review as CodexReview;

describe('buildCodexReviewModel', () => {
  const model = buildCodexReviewModel(record, { [PATH]: script });
  const [doc] = model.documents;

  it('shows the reviewed file at the reviewed commit, with the verdict in its trail', () => {
    expect(model.documents).toHaveLength(1);
    expect(doc.uri).toEqual({ scheme: 'git', authority: '640327f', path: '/' + PATH });
    expect(model.start).toEqual(['codex review 640327f: patch is incorrect (0.95)', PATH]);
  });

  it('puts each finding on its line range, P2 as a warning', () => {
    expect(doc.markers.map((m) => [m.severity, m.line, m.endLine])).toEqual([['warning', 24, 25], ['warning', 40, 42]]);
    expect(doc.markers[0].endColumn).toBe(script.split('\n')[24].length + 1);
    expect(doc.lenses.map((l) => l.line)).toEqual([24, 40]);
  });

  it('refuses a review whose file text is missing', () => {
    expect(() => buildCodexReviewModel(record, {})).toThrow(`no text for reviewed file ${PATH}`);
  });
});
