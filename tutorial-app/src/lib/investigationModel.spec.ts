import { describe, expect, it } from 'vitest';
import { buildInvestigationModel, type InvestigationDocument, type InvestigationModel, type Investigation } from './investigationModel';
import { forged, inDrive, investigation, planted, RULE, sameText } from '../stories/investigationFixtures';
import { helloContents, ls, runId, runInDrive } from '../stories/protonDriveFixtures';

// CIT-385: the behaviour of the lens/Peek/definition/marker logic, computed
// from the stories' investigation data with no Monaco. Exact bytes don't
// matter; which lines get lenses, where Peek and Go to Definition lead, and
// which lines carry markers do.

const HEADER = 4;

const docs = (model: InvestigationModel) => new Map(model.documents.map((d) => [d.id, d]));
const find = (model: InvestigationModel, pred: (d: InvestigationDocument) => boolean) => {
  const match = model.documents.filter(pred);
  expect(match, 'exactly one document should match').toHaveLength(1);
  return match[0];
};
const byPath = (model: InvestigationModel, scheme: string, endsWith: string) =>
  find(model, (d) => d.uri.scheme === scheme && d.uri.path.endsWith(endsWith));
/** A snapshot's copy of a file (as opposed to its baseline copy, same path). */
const fileDoc = (model: InvestigationModel, snapshot: string, path: string) =>
  find(model, (d) => d.uri.scheme === 'snapshot' && d.uri.authority === snapshot && d.uri.path === '/' + path);
/** The listing for one agent question, by its snapshot authority. */
const listing = (model: InvestigationModel, snapshot: string) =>
  find(model, (d) => d.uri.scheme === 'snapshot' && d.uri.authority === snapshot && d.text.startsWith(`snapshot ${snapshot}:`));

describe('buildInvestigationModel — the vault walk', () => {
  const model = buildInvestigationModel(investigation);
  const vault = byPath(model, 'vault', '/items');

  it('starts at the vault and lists it in the trail', () => {
    expect(model.homeId).toBe(vault.id);
    expect(model.start).toEqual(['investigations']);
  });

  it('squiggles the vault line that holds more questions than declared', () => {
    expect(vault.markers).toHaveLength(1);
    expect(vault.markers[0].line).toBe(3);
    expect(vault.markers[0].message).toContain('Expected one question, got three.');
    expect(vault.markers[0].severity).toBe('warning');
  });

  it('puts a Peek lens on that line, targeting each snapshot listing at 5:4', () => {
    expect(vault.lenses).toHaveLength(1);
    const lens = vault.lenses[0];
    expect(lens.line).toBe(3);
    expect(lens.title).toContain('Peek');
    expect(lens.peek).toBeDefined();
    expect(lens.peek!.anchor).toEqual({ lineNumber: 3, column: 3 });
    // One location per agent question, each the listing's first change line.
    expect(lens.peek!.locations).toHaveLength(investigation.agent.length);
    for (const loc of lens.peek!.locations) {
      expect(loc.range).toEqual({ startLineNumber: HEADER + 1, startColumn: 4, endLineNumber: HEADER + 1, endColumn: 4 });
    }
    const targets = new Set(lens.peek!.locations.map((l) => l.doc));
    for (const q of investigation.agent) expect(targets).toContain(listing(model, q.snapshot).id);
  });

  it('marks each listing change line that has a note', () => {
    const forgedListing = listing(model, forged.snapshot);
    // forged question: two changes, both noted, on lines 5 and 6.
    expect(forgedListing.markers.map((m) => m.line)).toEqual([HEADER + 1, HEADER + 2]);
    expect(forgedListing.markers[0].message).toContain("Shouldn't be here");
  });

  it('Go to Definition on a listing line opens that change file at the finding', () => {
    const forgedListing = listing(model, forged.snapshot);
    const plantedFile = fileDoc(model, forged.snapshot, planted.path);
    const canary = fileDoc(model, forged.snapshot, 'inputs/canary-reads.txt');
    // Line 5 (first change, the planted file) -> the planted file at its finding line.
    const def5 = forgedListing.definitions.find((d) => d.line === HEADER + 1)!;
    expect(def5.target).toEqual({ doc: plantedFile.id, line: planted.finding!.line });
    // Line 6 (the modified trace, no finding) -> that file at line 1.
    const def6 = forgedListing.definitions.find((d) => d.line === HEADER + 2)!;
    expect(def6.target).toEqual({ doc: canary.id, line: 1 });
  });

  it('a deleted change leads to the baseline copy', () => {
    const deleted: Investigation = {
      vault: 'v',
      question: 'q',
      agent: [{ tag: 'gone?', snapshot: 'snap', evidence: 'e', changes: [{ kind: 'D', path: 'inputs/old.txt', baseline: 'was here\n' }] }],
    };
    const m = buildInvestigationModel(deleted);
    const snapListing = listing(m, 'snap');
    const baseline = byPath(m, 'snapshot', '/inputs/old.txt');
    expect(baseline.uri.authority).toBe('baseline');
    expect(snapListing.definitions[0].target.doc).toBe(baseline.id);
  });

  it('shows each revision of the check as a verdict lens on the planted file, at its rule', () => {
    const plantedFile = fileDoc(model, forged.snapshot, planted.path);
    const verdictLenses = plantedFile.lenses.filter((l) => /passed|failed/.test(l.title));
    expect(verdictLenses.map((l) => l.title)).toEqual(['#117 ✗ passed', '#118 ✗ passed', '#120 ✓ failed']);
    const all = docs(model);
    for (const lens of verdictLenses) {
      expect(lens.line).toBe(planted.finding!.line);
      expect(lens.open).toBeDefined();
      expect(lens.open!.line).toBe(RULE);
      // Each opens a check document that exists in the model.
      expect(all.has(lens.open!.doc)).toBe(true);
    }
    // The three verdict lenses open three distinct check revisions.
    expect(new Set(verdictLenses.map((l) => l.open!.doc)).size).toBe(3);
  });

  it('the planted file (no baseline) gets a "not in the baseline" lens with no command', () => {
    const plantedFile = fileDoc(model, forged.snapshot, planted.path);
    const label = plantedFile.lenses.find((l) => l.title.includes('not in the baseline'))!;
    expect(label).toBeDefined();
    expect(label.line).toBe(1);
    expect(label.peek).toBeUndefined();
    expect(label.open).toBeUndefined();
    // Every line is new, so the gutter marks them all.
    expect(plantedFile.addedLines!.length).toBeGreaterThan(0);
  });

  it('a modified file Peeks at its baseline; "changed since the baseline"', () => {
    const canary = fileDoc(model, forged.snapshot, 'inputs/canary-reads.txt');
    const lens = canary.lenses.find((l) => l.title.startsWith('changed since'))!;
    expect(lens.title).toBe('changed since the baseline · Peek');
    expect(lens.line).toBe(1);
    // The Peek target is the baseline copy of the same file (authority "baseline").
    const baseline = find(model, (d) => d.uri.scheme === 'snapshot' && d.uri.authority === 'baseline' && d.uri.path === '/inputs/canary-reads.txt');
    expect(lens.peek!.locations[0].doc).toBe(baseline.id);
  });

  it('later check revisions Peek at the previous revision', () => {
    // #120's check changed since #118; #117 (the oldest) has no diff info.
    const checks = model.documents.filter((d) => d.uri.scheme === 'check');
    expect(checks).toHaveLength(3);
    const rev = (r: string) => find(model, (d) => d.uri.scheme === 'check' && d.uri.path.startsWith('/' + r + '/'));
    const c117 = rev('#117');
    const c118 = rev('#118');
    const c120 = rev('#120');
    // #117: no "changed since" / "not in the baseline" lens, no added lines.
    expect(c117.lenses.some((l) => l.title.startsWith('changed since') || l.title.includes('not in the baseline'))).toBe(false);
    expect(c117.addedLines).toBeUndefined();
    const since118 = c120.lenses.find((l) => l.title.startsWith('changed since'))!;
    expect(since118.title).toBe('changed since #118 · Peek');
    expect(since118.peek!.locations[0].doc).toBe(c118.id);
    // #118 Peeks back at #117.
    expect(c118.lenses.find((l) => l.title.startsWith('changed since'))!.peek!.locations[0].doc).toBe(c117.id);
  });
});

describe('buildInvestigationModel — the Drive walk (inDrive)', () => {
  const model = buildInvestigationModel(inDrive);
  const drive = byPath(model, 'drive', '/investigations');

  it('starts in the Drive folder', () => {
    expect(model.homeId).toBe(drive.id);
    expect(model.start).toEqual(['Proton Drive', 'investigations']);
  });

  it('marks only the new archive line with its finding count', () => {
    // Two archives: line 2 is last month's baseline (no findings), line 3 is new.
    expect(drive.markers).toHaveLength(1);
    expect(drive.markers[0].line).toBe(3);
    expect(drive.markers[0].message).toContain('3 findings since the last archive.');
  });

  it('the new archive has an "open the archive" lens and a definition into its listing', () => {
    const newArchive = inDrive.agent[0];
    const archiveListing = listing(model, newArchive.snapshot);
    const lens = drive.lenses.find((l) => l.title.includes('open the archive'))!;
    expect(lens.line).toBe(3);
    expect(lens.open).toEqual({ doc: archiveListing.id, line: HEADER + 1 });
    const def = drive.definitions.find((d) => d.line === 3)!;
    expect(def.target).toEqual({ doc: archiveListing.id, line: HEADER + 1 });
    // The baseline archive (line 2) has no owner, so no lens or definition there.
    expect(drive.lenses.some((l) => l.line === 2)).toBe(false);
    expect(drive.definitions.some((d) => d.line === 2)).toBe(false);
  });
});

describe('buildInvestigationModel — referential integrity', () => {
  for (const [name, inv] of [['vault', investigation], ['drive', inDrive]] as const) {
    it(`every ${name} lens and definition target resolves to a document`, () => {
      const model = buildInvestigationModel(inv);
      const ids = new Set(model.documents.map((d) => d.id));
      expect(ids.has(model.homeId)).toBe(true);
      for (const doc of model.documents) {
        for (const lens of doc.lenses) {
          for (const loc of lens.peek?.locations ?? []) expect(ids.has(loc.doc)).toBe(true);
          if (lens.open) expect(ids.has(lens.open.doc)).toBe(true);
        }
        for (const def of doc.definitions) expect(ids.has(def.target.doc)).toBe(true);
      }
    });
  }

  it('does not use the sameText rule in a way that leaks into #117', () => {
    // Guard against an off-by-one in the verdict chain: #117's check never
    // contains the stronger rule line #118 added.
    const model = buildInvestigationModel(investigation);
    const c117 = find(model, (d) => d.uri.scheme === 'check' && d.uri.path.startsWith('/#117/'));
    expect(c117.text).not.toContain(sameText.trim());
  });
});

// CIT-388: a real Drive walk, from the run folder to a file in the snapshot.
describe('buildInvestigationModel — a real snapshot from Drive', () => {
  const model = buildInvestigationModel(runInDrive);
  const byTrailEnd = (last: string) => find(model, (d) => d.trail[d.trail.length - 1] === last);
  const opens = (doc: InvestigationDocument, title: string) => {
    const lens = doc.lenses.find((l) => l.title === title);
    expect(lens, `lens "${title}"`).toBeDefined();
    expect(doc.definitions.find((d) => d.line === lens!.line)?.target).toEqual(lens!.open);
    return docs(model).get(lens!.open!.doc)!;
  };

  it('starts at the run folder, one path step per folder', () => {
    expect(model.start).toEqual(['Proton Drive', 'my-files', runId]);
    expect(docs(model).get(model.homeId)!.text).toContain('restic-repo   folder · 2026-10-09 22:05 UTC');
  });

  it('walks run folder → restic-repo → snapshots → the snapshot → hello.txt, each with ↑ back one level', () => {
    const home = docs(model).get(model.homeId)!;
    const repo = opens(home, 'open restic-repo/');
    expect(repo.parent).toBe(home.id);
    const snapshots = opens(repo, 'open snapshots/');
    expect(snapshots.parent).toBe(repo.id);
    const tree = opens(snapshots, 'open the snapshot · 1 file');
    expect(tree.uri).toEqual({ scheme: 'snapshot', authority: ls.snapshot.id, path: '/' });
    expect(tree.parent).toBe(snapshots.id);
    const file = opens(tree, 'open hello.txt');
    expect(file.uri).toEqual({ scheme: 'snapshot', authority: ls.snapshot.id, path: '/tmp/tmp.XSDJnYLG2i/hello.txt' });
    expect(file.parent).toBe(tree.id);
    expect(file.trail.slice(-3)).toEqual(['tmp', 'tmp.XSDJnYLG2i', 'hello.txt']);
  });

  it("drops the snapshot label when the name is the snapshot's ID", () => {
    const snapshots = byTrailEnd('snapshots');
    expect(snapshots.text).toContain(`${ls.snapshot.id}   taken 2026-10-09 22:05 UTC`);
    expect(snapshots.text).not.toContain(`snapshot ${ls.snapshot.short_id}`);
    // A name that isn't the ID keeps it.
    expect(docs(buildInvestigationModel(inDrive)).get(buildInvestigationModel(inDrive).homeId)!.text).toContain('release-2026-09.tar.gz   snapshot 9f41c2d0 · the baseline');
  });

  it("hello.txt is what the run wrote, the 47 bytes restic lists", () => {
    const hello = ls.nodes.find((n) => n.name === 'hello.txt')!;
    expect(helloContents).toBe(`${runId}\n`);
    expect(new TextEncoder().encode(helloContents).length).toBe(hello.size);
  });

  it('only opens what it has: no lens on folders without a listing', () => {
    const repo = byTrailEnd('restic-repo');
    expect(repo.lenses.map((l) => l.title)).toEqual(['open snapshots/']);
    expect(repo.markers).toEqual([]);
  });
});
