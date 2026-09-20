import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { integrationLogRecord } from './integrationLogRecord';

const jsonlPath = fileURLToPath(
  new URL('../content/tutorial/part-1/chapter-3/lesson-4/_files/reason-log.jsonl', import.meta.url),
);

describe('lesson-4 reason-log.jsonl pre-merge record (CIT-176)', () => {
  it('is revision-qualified: contributions, path, rule and check each name their revision', () => {
    const record = integrationLogRecord();
    expect(record.diagnostic.code).toBe('POLICY_CLASS_REACHES_EXTERNAL');
    expect(record.related.length).toBeGreaterThanOrEqual(5);
    for (const r of record.related) expect(r.revision).toMatch(/^sim-[0-9a-f]{8}$/);
    const revisions = new Set(record.related.map((r) => r.revision));
    expect(revisions.size).toBeGreaterThanOrEqual(3); // A, B, integration
  });

  it('the committed fourth line equals the evaluator output exactly', () => {
    if (process.env.WRITE_FIXTURE) {
      const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).slice(0, 3);
      writeFileSync(jsonlPath, [...lines, JSON.stringify(integrationLogRecord())].join('\n') + '\n');
    }
    const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[3])).toEqual(JSON.parse(JSON.stringify(integrationLogRecord())));
  });
});
