/* Mirrors part-2/chapter-1/lesson-1/_files/pkl/AcpDiagnosticMeta.pkl.
 *
 * NOT machine-generated: the repo's usual `pkl-typescript` vendoring
 * command (`npx @pkl-community/pkl-typescript -o ts pkl/<Module>.pkl`, see
 * governedVocabulary.pkl.ts / grant_state.pkl.ts for that convention) needs
 * network access to fetch `@pkl-community/pkl-typescript`, which this
 * environment did not have. `pkl eval` against the `.pkl` module above did
 * run clean, so the module itself is verified -- only the TS mirror below
 * is hand-written from its shape. Re-run the real generator and replace
 * this file (drop this header) the next time that package is reachable.
 */
export type AcpDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface AcpDiagnostic {
  severity: AcpDiagnosticSeverity;
  code: string;
  message: string;
  source: string;
}

export interface AcpDiagnosticMeta {
  diagnostic: AcpDiagnostic;
}
