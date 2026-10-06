import { railsProbes } from '../rails-probes/collectors';

// CIT-317: every collector a Question can name, by that name. A collector gathers
// one Question's evidence into the part's run directory and returns each answer
// it collected, labelled with where it was asked (`at`, e.g. a revision). It
// throws when it cannot collect: that, and only that, fails the Question.
export type Collected = { at: string; answer: unknown };
export type Collector = (partDir: string) => Collected[] | Promise<Collected[]>;

export const collectors: Record<string, Collector> = { ...railsProbes };
