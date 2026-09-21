import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import '../../lib/toHaveVerdict';
import {
  FM,
  ORDERED_ROUTING,
  THREAD_MODELS,
  WITNESS_MODELS,
  arrivalOrderWitness,
  check,
  flagLabel,
  reorderBufferWitness,
  requiredDeliveries,
  type Witness,
} from './followerMaze';
import {
  BASELINE,
  FAMILY,
  badgeText,
  boardFor,
  counterText,
  evaluateFamily,
  familyRecords,
  initialLessonState,
  outcomeCategory,
  pairedRows,
  reduceLesson,
  toJsonl,
  worldFor,
  type LessonAction,
} from './followerMazeLog';

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

/**
 * The oracle, written out on purpose: the table from CIT-203's description,
 * reproduced independently by followermaze-permutations.py (see the last test).
 */
const EXPECTED = {
  pass: ['1234', '3412', '4123', '4312'],
  missing: ['1324', '1342', '2134', '2341', '2413', '2431', '3241', '3421', '4132', '4213', '4231', '4321'],
  forbidden: ['1243', '1423', '3124', '3142'],
  both: ['1432', '2143', '2314', '3214'],
};

const byCategory = (model: keyof typeof WITNESS_MODELS) => {
  const out: Record<string, string[]> = { pass: [], missing: [], forbidden: [], both: [], other: [] };
  for (const { name, flags } of evaluateFamily(model)) out[outcomeCategory(flags.map(flagLabel))].push(name);
  return out;
};

describe('follower maze: the world', () => {
  const baseline = worldFor(BASELINE);

  it('entails exactly 20 <- seq 1 and 10 <- seq 2', () => {
    expect(requiredDeliveries(baseline).map((d) => `${d.user}<-${d.sequence}`)).toEqual(['10<-2', '20<-1']);
  });

  it('has one fixture per arrival ordering, all permutations of the same four events', () => {
    expect(FAMILY).toHaveLength(24);
    for (const { arrival } of FAMILY) expect([...arrival].sort()).toEqual([1, 2, 3, 4]);
    expect(new Set(FAMILY.map(({ name }) => name)).size).toBe(24);
  });
});

describe('follower maze: witnesses over the 24-ordering family', () => {
  it('arrival-order witness matches the description table exactly', () => {
    expect(byCategory('arrival-order')).toEqual({ ...EXPECTED, other: [] });
  });

  it('reorder-buffer witness (sequence-aware) passes all 24', () => {
    expect(byCategory('reorder-buffer').pass).toHaveLength(24);
  });

  it('records all 24 evaluations through toHaveVerdict, with the expected verdict for each', () => {
    const verdictFor = (name: string) =>
      EXPECTED.pass.includes(name)
        ? 'PASS'
        : EXPECTED.forbidden.includes(name)
          ? FM.forbiddenDelivery
          : FM.missingDelivery; // 'both' reports its first flag: missing before forbidden
    for (const { name, arrival } of FAMILY) {
      const world = worldFor(arrival);
      expect(`arrival-${name}`).toHaveVerdict(
        ORDERED_ROUTING,
        { world, witness: arrivalOrderWitness(world) },
        verdictFor(name),
      );
      expect(`arrival-${name}`).toHaveVerdict(ORDERED_ROUTING, { world, witness: reorderBufferWitness(world) }, 'PASS');
    }
  });

  it('the baseline is a coincidence: the wrong model passes 4 of 24, 1 in 6', () => {
    const passing = evaluateFamily('arrival-order').filter((outcome) => outcome.flags.length === 0);
    expect(passing.map((outcome) => outcome.name)).toContain(BASELINE.join(''));
    expect(passing.length / FAMILY.length).toBeCloseTo(1 / 6);
  });

  it('the family exercises two fm-* codes, both forbidden and missing in the "both" orderings', () => {
    const kinds = new Set(evaluateFamily('arrival-order').flatMap(({ flags }) => flags.map((flag) => flag.kind)));
    expect([...kinds].sort()).toEqual([FM.forbiddenDelivery, FM.missingDelivery]);
    const world = worldFor([1, 4, 3, 2]);
    expect(check(world, arrivalOrderWitness(world)).map(flagLabel)).toEqual([
      'fm-missing-delivery(seq=2,user=10)',
      'fm-forbidden-delivery(seq=4,user=10)',
    ]);
  });
});

describe('follower maze: the other two fm-* codes (unreachable from the family, so hand-built)', () => {
  const world = worldFor(BASELINE);
  const good = requiredDeliveries(world);

  it('fm-out-of-order: a client sees a lower sequence after a higher one', () => {
    const witness: Witness = {
      deliveries: [
        { user: 10, sequence: 4, payload: '4|S|20' },
        { user: 10, sequence: 2, payload: '2|S|20' },
        { user: 20, sequence: 1, payload: '1|F|10|20' },
      ],
    };
    // seq 4 is also forbidden for user 10, so the listing raises both.
    expect(check(world, witness).map((flag) => flag.kind)).toEqual([FM.forbiddenDelivery, FM.outOfOrder]);
  });

  it('fm-payload-mutated: the right delivery carrying the wrong bytes', () => {
    const witness: Witness = { deliveries: good.map((d) => (d.user === 10 ? { ...d, payload: '2|S|21' } : d)) };
    expect(check(world, witness).map(flagLabel)).toEqual(['fm-payload-mutated(seq=2,user=10)']);
  });
});

describe('follower maze: Pkl and TypeScript are the same proposition', () => {
  const pklAvailable = spawnSync('pkl', ['--version']).status === 0;

  it.skipIf(!pklAvailable)('FollowerMaze.pkl check() and followerMaze.ts check() agree on every case', () => {
    const witnesses: Record<string, Record<string, readonly unknown[]>> = {};
    for (const model of Object.keys(WITNESS_MODELS) as (keyof typeof WITNESS_MODELS)[]) {
      witnesses[model] = Object.fromEntries(
        FAMILY.map(({ name, arrival }) => [name, WITNESS_MODELS[model](worldFor(arrival)).deliveries]),
      );
    }
    // A hand-built witness per remaining code, so the diff covers all four.
    const world = worldFor(BASELINE);
    witnesses.handBuiltOutOfOrder = {
      '1234': [
        { user: 10, sequence: 4, payload: '4|S|20' },
        { user: 10, sequence: 2, payload: '2|S|20' },
        { user: 20, sequence: 1, payload: '1|F|10|20' },
      ],
    };
    witnesses.handBuiltPayloadMutated = {
      '1234': requiredDeliveries(world).map((d) => (d.user === 10 ? { ...d, payload: '2|S|21' } : d)),
    };

    const pkl = JSON.parse(
      execFileSync('pkl', ['eval', '-f', 'json', '-p', `witnesses=${JSON.stringify(witnesses)}`, here('FollowerMazeFamily.pkl')], {
        encoding: 'utf8',
      }),
    ).flags as Record<string, Record<string, unknown[]>>;

    const arrivalOf = (name: string) => FAMILY.find((f) => f.name === name)!.arrival;
    for (const [model, byName] of Object.entries(witnesses)) {
      for (const [name, deliveries] of Object.entries(byName)) {
        const ts = check(worldFor(arrivalOf(name)), { deliveries: deliveries as Witness['deliveries'] }).map(
          ({ kind, factID, detail }) => ({ kind, factID, detail }),
        );
        expect(pkl[model][name], `${model}/${name}`).toEqual(ts);
      }
    }
  });

  it.skipIf(!pklAvailable)('FollowerMaze.pkl parses and every fixture arrival is read by the Pkl side', () => {
    const out = JSON.parse(
      execFileSync('pkl', ['eval', '-f', 'json', '-p', `witnesses=${JSON.stringify({ empty: Object.fromEntries(FAMILY.map((f) => [f.name, []])) })}`, here('FollowerMazeFamily.pkl')], { encoding: 'utf8' }),
    ).flags.empty as Record<string, unknown[]>;
    expect(Object.keys(out)).toHaveLength(24);
    // An empty witness misses both required deliveries in every ordering.
    for (const flags of Object.values(out)) expect(flags).toHaveLength(2);
  });
});

describe('follower maze: fixtures are regenerable, not trusted', () => {
  it.each(['arrival-order', 'reorder-buffer'] as const)('permutations.%s.jsonl equals what the code produces', (model) => {
    const file = here(`fixtures/permutations.${model}.jsonl`);
    // UPDATE_FIXTURES=1 npx vitest run src/lesson-farms rewrites the committed logs.
    if (process.env.UPDATE_FIXTURES) writeFileSync(file, toJsonl(familyRecords(model)));
    const committed = readFileSync(file, 'utf8');
    expect(committed).toBe(toJsonl(familyRecords(model)));
  });

  it('followermaze-permutations.py (stdlib, independent) reports the same table', () => {
    const python = spawnSync('python3', ['--version']);
    if (python.status !== 0) return;
    const out = execFileSync('python3', [here('followermaze-permutations.py')], { encoding: 'utf8' });
    const parsed: Record<string, string[]> = {};
    for (const match of out.matchAll(/^(pass|missing|forbidden|both)\s+\d+\s+(\[.*\])$/gm)) {
      parsed[match[1]] = JSON.parse(match[2].replace(/'/g, '"'));
    }
    expect(parsed).toEqual(EXPECTED);
  });
});

describe('follower maze: the diagnostic carries the copy the review asked for', () => {
  const failing = familyRecords('arrival-order').find((record) => record.raw.startsWith('[4,2,3,1]'))!;

  it('states why an ordering error surfaces as a routing error', () => {
    const axiom = failing.related.find((entry) => entry.role === 'axiom')!;
    expect(axiom.uri).toBe(ORDERED_ROUTING);
    expect(axiom.detail).toContain('ordering errors surface as routing errors because follow-state is temporal');
  });

  it('names every repair the evidence can stand for, and the flag with its seq and user', () => {
    expect(failing.diagnostic).toMatchObject({ severity: 'error', code: FM.missingDelivery });
    const text = failing.related.map((entry) => entry.detail).join('\n');
    expect(text).toContain('fm-missing-delivery(seq=2,user=10)');
    for (const repair of ['change world', 'change model', 'change axiom']) expect(text).toContain(repair);
  });
});

describe('follower maze: the lesson board', () => {
  const drive = (...actions: LessonAction[]) => boardFor(actions.reduce(reduceLesson, initialLessonState));
  const solve: LessonAction = { type: 'solve', model: 'arrival-order' };

  it('starts with the events entered as the editor lines, nothing observed, no diagnostic (CIT-227)', () => {
    const board = drive();
    expect(board.thread.arrival.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(board.thread.steps).toBeNull();
    // the log is the input channel: the four events as entered, and nothing the implementation emitted
    expect(board.records.map((r) => r.raw)).toEqual(['1|F|10|20', '2|S|20', '3|U|10|20', '4|S|20']);
    expect(board.records.some((r) => r.diagnostic)).toBe(false);
    expect(counterText(board.tally)).toBe('not evaluated');
  });

  it('solve puts the emitted deliveries in the monitor, in emission order, without touching the log', () => {
    const board = drive(solve);
    expect(board.thread.steps!.map((s) => s.emitted.map((d) => d.sequence))).toEqual([[1], [2], [], []]);
    expect(board.records.map((r) => r.raw)).toEqual(['1|F|10|20', '2|S|20', '3|U|10|20', '4|S|20']); // emitted deliveries are not log lines
    expect(board.records.every((r) => r.diagnostic === null)).toBe(true);
  });

  it('selecting an ordering is an alternate execution of the same thread; the reorder buffer holds early events', () => {
    const board = drive({ type: 'solve', model: 'reorder-buffer' }, { type: 'transform' }, { type: 'select', name: '4231' });
    expect(board.thread.name).toBe('4231');
    expect(board.thread.arrival.map((e) => e.sequence)).toEqual([4, 2, 3, 1]);
    expect(board.thread.steps!.map((s) => s.held ?? null)).toEqual([
      'held: waiting for seq 1', 'held: waiting for seq 1', 'held: waiting for seq 1', null,
    ]);
    expect(board.thread.steps![3].emitted.map((d) => d.sequence)).toEqual([1, 2]);
    // selecting outside the family (the baseline stage) is a no-op
    expect(reduceLesson(initialLessonState, { type: 'select', name: '4231' })).toBe(initialLessonState);
  });

  it('the monitor thread and the witness never disagree', () => {
    for (const model of Object.keys(WITNESS_MODELS) as (keyof typeof WITNESS_MODELS)[]) {
      for (const { arrival } of FAMILY) {
        const world = worldFor(arrival);
        const emitted = THREAD_MODELS[model](world).flatMap((s) => s.emitted).map((d) => `${d.user}:${d.sequence}`).sort();
        expect(emitted).toEqual(WITNESS_MODELS[model](world).deliveries.map((d) => `${d.user}:${d.sequence}`).sort());
      }
    }
  });

  it('cannot evaluate before solve() has produced a witness', () => {
    expect(reduceLesson(initialLessonState, { type: 'evaluate' })).toBe(initialLessonState);
  });

  it('a green baseline is followed by a visible warning derived from the family, not a constant', () => {
    const board = drive(solve, { type: 'evaluate' });
    const at = board.records.findIndex((r) => r.raw.startsWith('evaluate'));
    expect(board.records[at].raw).toMatch(/-> pass$/);
    expect(board.records[at].diagnostic).toBeNull();
    // The warning is the next line of the log: text on screen, not only a marker message.
    const warning = board.records[at + 1];
    const sentence = 'This ordering passes, but this model fails 20 of the other 23. Test all 24 orderings.';
    expect(warning.raw).toBe(sentence);
    expect(warning.diagnostic).toMatchObject({
      severity: 'warning',
      code: 'lesson-baseline-nondiscriminating',
      message: sentence,
      lensTitle: 'passes here, fails 20 of the other 23',
    });
    expect(warning.evaluationId).toBeNull(); // not an evaluation: the counter still says 1 pass
    expect(counterText(board.tally)).toBe('1 pass · 0 missing · 0 forbidden · 0 both');
  });

  it('a witness that passes the whole family gets no baseline warning', () => {
    const board = drive({ type: 'solve', model: 'reorder-buffer' }, { type: 'evaluate' });
    expect(board.records.some((r) => r.diagnostic)).toBe(false);
    expect(board.records.at(-1)!.raw).toMatch(/-> pass$/);
  });

  it('transform resets evaluation; evaluating the family fills the counter footer', () => {
    const transformed = drive(solve, { type: 'evaluate' }, { type: 'transform' });
    expect(transformed.records).toHaveLength(24);
    expect(transformed.records.every((r) => r.diagnostic === null)).toBe(true);
    expect(badgeText(transformed)).toBe('followerMaze.orderedRouting · 24 worlds');

    const evaluated = drive(solve, { type: 'transform' }, { type: 'evaluate' });
    expect(counterText(evaluated.tally)).toBe('4 pass · 12 missing · 4 forbidden · 4 both');
    expect(evaluated.records.filter((r) => r.diagnostic).length).toBe(20);
  });

  it('a second axiom on the board turns the badge into a failure', () => {
    const board = drive(solve, { type: 'transform' });
    board.axiomIds.push('somethingElse.entirely');
    expect(badgeText(board)).toContain('the transfer failed');
  });
});

describe('follower maze: the failing world is a comparison, not prose (CIT-226)', () => {
  const record = (name: string, model: keyof typeof WITNESS_MODELS = 'arrival-order') =>
    familyRecords(model).find((r) => r.raw.startsWith(`[${name.split('').join(',')}]`))!;

  it('pairs expected with actual, the missing delivery holding its expected position', () => {
    const rows = record('4231').related.filter((entry) => entry.uri === 'expected|actual').map((entry) => entry.detail);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^row\s+expected\s+\| actual$/);
    expect(rows[1]).toMatch(/^1\/2\s+10 <- seq 2\s+\| - - missing - -\s+\[missing\]$/);
    expect(rows[2]).toMatch(/^2\/2\s+20 <- seq 1\s+\| 20 <- seq 1\s+\[ok\]$/);
    // one line of the 600px evidence widget (~80 mono chars, less its 'observation (expected|actual): ' prefix)
    expect(rows.every((row) => row.length + 'observation (expected|actual): '.length <= 80)).toBe(true);
  });

  it('mirrors it for a forbidden delivery: nothing due, something delivered', () => {
    const world = worldFor([1, 2, 4, 3]);
    const rows = pairedRows(world, WITNESS_MODELS['arrival-order'](world));
    expect(rows).toHaveLength(4); // header + 2 required + 1 forbidden
    expect(rows[3]).toMatch(/^3\/3\s+- - not due - -\s+\| 10 <- seq 4\s+\[forbidden\]$/);
  });

  it('a correct witness pairs every row ok', () => {
    const world = worldFor([4, 2, 3, 1]);
    expect(pairedRows(world, reorderBufferWitness(world)).slice(1).every((row) => row.endsWith('[ok]'))).toBe(true);
  });

  it('every evaluated row names its outcome, so pass is not the same text as unevaluated', () => {
    const unevaluated = familyRecords('arrival-order', false).map((r) => r.raw);
    expect(unevaluated.some((raw) => raw.includes('->'))).toBe(false);
    for (const [category, names] of Object.entries(EXPECTED)) {
      for (const name of names) expect(record(name).raw).toMatch(new RegExp(`-> ${category}$`));
    }
  });

  it('lens titles say the outcome in words: "both" is not filed under its first code', () => {
    expect(record('1432').diagnostic!.lensTitle).toBe('both: missing 10 <- seq 2, forbidden 10 <- seq 4');
    expect(record('1243').diagnostic!.lensTitle).toBe('forbidden 10 <- seq 4');
    expect(record('4231').diagnostic!.lensTitle).toBe('missing 10 <- seq 2');
    expect(familyRecords('arrival-order').every((r) => !r.diagnostic || !r.diagnostic.lensTitle!.includes('fm-'))).toBe(true);
  });

  it('separates the repair the learner can make from the conceptual ones', () => {
    const text = (role: string) => record('4231').related.filter((e) => e.role === role).map((e) => e.detail).join('\n');
    expect(text('observation')).toContain('(change model: available');
    expect(text('fact')).toContain('(change world: conceptual');
    expect(text('axiom')).toContain('(change axiom: conceptual');
  });

  it('the grid data: 24 cases, unlabelled until evaluated, the table once evaluated', () => {
    const drive = (...actions: LessonAction[]) => boardFor(actions.reduce(reduceLesson, initialLessonState));
    const solve: LessonAction = { type: 'solve', model: 'arrival-order' };
    expect(drive(solve).cases).toEqual([]);
    expect(drive(solve, { type: 'transform' }).cases.every((c) => c.category === null)).toBe(true);
    const evaluated = drive(solve, { type: 'transform' }, { type: 'evaluate' }).cases;
    for (const [category, names] of Object.entries(EXPECTED)) {
      expect(evaluated.filter((c) => c.category === category).map((c) => c.name)).toEqual(names);
    }
  });

  it('changing the model in place reruns the same family: 4231 flips from missing to pass', () => {
    const before = [{ type: 'solve', model: 'arrival-order' }, { type: 'transform' }, { type: 'evaluate' }] as LessonAction[];
    const after = [...before, { type: 'solve', model: 'reorder-buffer' }, { type: 'evaluate' }] as LessonAction[];
    const at = (actions: LessonAction[]) => boardFor(actions.reduce(reduceLesson, initialLessonState));
    expect(at(before).cases.find((c) => c.name === '4231')!.category).toBe('missing');
    const rerun = at(after);
    expect(rerun.cases.find((c) => c.name === '4231')!.category).toBe('pass');
    expect(counterText(rerun.tally)).toBe('24 pass · 0 missing · 0 forbidden · 0 both');
    expect(rerun.worlds).toBe(24); // same family, not a new one
    expect(rerun.axiomIds).toEqual([ORDERED_ROUTING]);
  });
});
