// The Dagger exit code is the only input to a claim's verdict.
export function claimVerdict(exit: number) {
  return exit === 0 ? { kind: 'passed', label: 'Green · Passed' } : { kind: 'failed', label: 'Red · Failed' };
}
