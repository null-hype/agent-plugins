import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const expectedInput = 'area51:site4:black-budget-vault-access';

it('accepts the exact Warm Log input', () => {
  const input = readFileSync('warm-log.txt', 'utf8').replace(/\r?\n$/, '');
  expect(input).toBe(expectedInput);
});
