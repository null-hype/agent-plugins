// The installed feature owns the verified loader and checker runner.
// Existing replay consumers supply their retained evidence root.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as checker from '../../../src/cve-2026-66066/questions/checker/probes';
export * from '../../../src/cve-2026-66066/questions/checker/probes';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const pinnedInputs = (key: checker.RevisionKey) => checker.pinnedInputs(key, APP);
export const loadPinnedChecker = (key: checker.RevisionKey) => checker.loadPinnedChecker(key, APP);
