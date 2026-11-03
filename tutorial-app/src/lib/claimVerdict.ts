// The Dagger exit code is the only input to a claim's verdict.
export function claimVerdict(exit: number) {
  return exit === 0 ? { kind: 'passed', label: 'Green · Passed' } : { kind: 'failed', label: 'Red · Failed' };
}

export type Requirement = { identifier: string; title: string; exit?: number };

// A claim's standing on a card: not run, or its verdict, unless a control it
// requires has not passed, in which case its own result can't be read yet.
export function claimStanding(exit: number | undefined, requires: Requirement[] = []) {
  if (exit === undefined) return { kind: 'untested', label: 'Not run' };
  if (requires.some(r => r.exit !== 0)) return { kind: 'stale', label: exit === 0 ? 'Held · controls not passed' : 'Missed · controls not passed' };
  return claimVerdict(exit);
}
