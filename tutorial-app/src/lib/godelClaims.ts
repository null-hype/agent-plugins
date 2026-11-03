import type { ClaimCardProps } from '../components/ClaimCard';

// The godel claim and its two controls, from null-hype/godel-check. Hand-copied
// for now: the liar's one observed run (worlds, expectation as a .env literal)
// and two controls that have not run. Not yet fed from a publisher.
const repo = 'https://github.com/null-hype/godel-check';

const fiveWords = { identifier: 'GODEL-2', title: 'This sentence has five words.' };
const threeWords = { identifier: 'GODEL-3', title: 'This sentence has three words.' };

export const godelClaims: ClaimCardProps[] = [
  {
    identifier: 'GODEL-1', title: 'This sentence is false.', check: 'this-sentence-is-false', exit: 1, href: repo,
    detail: 'Predicted 0.5. Jev answered 0.13, 0.12, 0.12.',
    requires: [fiveWords, threeWords],
  },
  { ...fiveWords, check: 'this-sentence-has-five-words', href: `${repo}/tree/five-words-control/controls/five-words`, detail: 'Positive control. True, so predicted 0.9.' },
  { ...threeWords, check: 'this-sentence-has-three-words', href: repo, detail: 'Negative control. False, so predicted near 0. Not built yet.' },
];
