import type { APIRequestContext } from '@playwright/test';
import { jev } from '../jev/collectors';
import { railsProbes } from '../rails-probes/collectors';
import { sharedModel } from '../shared-model/collectors';

// CIT-317: every collector a Question can name, by that name. A collector gathers
// one Question's evidence into the part's run directory and returns each answer
// it collected, labelled with where it was asked (`at`, e.g. a revision). It
// throws when it cannot collect: that, and only that, fails the Question.
// `evidence` is what the Question's `requiredEvidence` names, when it is not the
// answer itself (a Jev answer is a probability judged on the evidence).
export type Collected = { at: string; answer: unknown; evidence?: object };
export type Asked = { id: string; question: any; request: APIRequestContext };
export type Collector = (partDir: string, asked: Asked) => Collected[] | Promise<Collected[]>;

export const collectors: Record<string, Collector> = { ...railsProbes, ...jev, ...sharedModel };
