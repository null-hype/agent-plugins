// Offline case adapter: run the original Vaults contract, retaining its inputs,
// generated baselines and fresh observations before removing temporary state.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = ".dagger/internal/devenv-base/pkl";
const hash = (bytes: string | Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
type Evidence = {
  uri: string;
  origin: "historical" | "reproduced";
  availability: "retained" | "missing";
  immutableId: string | null;
  reason: string | null;
};

export function replay(input: string, out: string) {
  const manifestBytes = readFileSync(path.join(input, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString());
  const load = (file: string, digest: string, blob?: string) => {
    const name = path.resolve(input, file);
    if (!name.startsWith(`${path.resolve(input)}/`)) {
      throw new Error("input path escapes bundle");
    }
    const bytes = readFileSync(name);
    if (hash(bytes) !== digest) {
      throw new Error(`retained input changed: ${file}`);
    }
    if (
      blob &&
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest(
          "hex",
        ) !== blob
    ) throw new Error(`git blob mismatch: ${file}`);
    return bytes;
  };
  const inventory = load(manifest.inventory.file, manifest.inventory.sha256);
  // Verify the complete scope before executing either historical contract.
  const states = manifest.states.map((s: any) => ({
    ...s,
    files: s.files.map((f: any) => ({
      ...f,
      bytes: load(f.file, f.sha256, f.blob),
    })),
  }));
  const pkl = execFileSync("pkl", ["--version"], { encoding: "utf8" }).trim();
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length) {
    throw new Error("replay output directory must be empty");
  }
  const save = (
    uri: string,
    bytes: string | Buffer,
    origin: Evidence["origin"] = "reproduced",
  ): Evidence => {
    const name = path.join(out, uri);
    mkdirSync(path.dirname(name), { recursive: true });
    writeFileSync(name, bytes);
    return {
      uri,
      origin,
      availability: "retained",
      immutableId: hash(bytes),
      reason: null,
    };
  };
  const gap = (uri: string, reason: string): Evidence => ({
    uri,
    origin: "historical",
    availability: "missing",
    immutableId: null,
    reason,
  });
  const observed = save("inputs/vaults-observed.json", inventory, "historical");
  const provenance = save("manifest.json", manifestBytes, "historical");
  const questionId = "declared-vault-inventory";
  const records = states.map((state: any) => {
    const prefix = state.id;
    const dir = mkdtempSync(path.join(tmpdir(), "vaults-replay-"));
    const inputs: Evidence[] = [observed];
    try {
      const materialize = (rel: string, bytes: Buffer) => {
        const target = path.resolve(dir, rel);
        if (!target.startsWith(`${dir}/`)) {
          throw new Error("state path escapes workspace");
        }
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, bytes);
      };
      for (const f of state.files) {
        materialize(f.path, f.bytes);
        inputs.push(save(`${prefix}/inputs/${f.path}`, f.bytes, "historical"));
      }
      materialize(
        ".dagger/internal/devenv-base/build/vaults-observed.json",
        inventory,
      );
      const test = `${base}/Vaults.test.pkl`;
      const run = (args: string[], name: string) => {
        const result = spawnSync("pkl", args, { cwd: dir, encoding: "utf8" });
        if (result.error || result.status === null) {
          throw new Error(
            `could not collect contract answer: ${
              result.error ?? result.signal
            }`,
          );
        }
        const output = result.stdout + result.stderr;
        const evidence = save(`${prefix}/${name}.txt`, output);
        return { output, evidence, status: result.status };
      };
      const original = run(["test", test], "original-baseline");
      if (/examples written/.test(original.output)) {
        throw new Error("original expected baseline is missing");
      }
      // Preserve the old PCF above, and generate the new baseline in the copy.
      // --overwrite does not repair failed facts. They are assessed again below.
      const generated = run(["test", "--overwrite", test], "generate-baseline");
      const baseline = save(
        `${prefix}/generated/Vaults.test.pkl-expected.pcf`,
        readFileSync(path.join(dir, `${test}-expected.pcf`)),
      );
      const checked = run(["test", test], "checked");
      if (!/% tests pass/.test(checked.output)) {
        throw new Error(
          `contract did not produce an assertion summary: ${checked.output}`,
        );
      }
      const count = (kind: string) => {
        const m = checked.output.match(
          new RegExp(
            `% ${kind} pass \\[(?:(\\d+) passed|(\\d+)/(\\d+) failed)\\]`,
          ),
        );
        if (!m) throw new Error(`missing ${kind} count`);
        return m[1]
          ? [Number(m[1]), Number(m[1])]
          : [Number(m[3]) - Number(m[2]), Number(m[3])];
      };
      const [testsPassed, testsTotal] = count("tests");
      const [assertsPassed, assertsTotal] = count("asserts");
      const answer = {
        exitCode: checked.status,
        testsPassed,
        testsTotal,
        assertsPassed,
        assertsTotal,
      };
      const answerEvidence = save(
        `${prefix}/answer.json`,
        JSON.stringify(answer, null, 2) + "\n",
      );
      const declared = JSON.parse(
        execFileSync("pkl", ["eval", "-f", "json", `${base}/Vaults.pkl`], {
          cwd: dir,
          encoding: "utf8",
        }),
      );
      const topology = JSON.parse(inventory.toString());
      const mismatches = declared.declared.flatMap((v: any) => {
        const found = topology.vaults.find((o: any) => o.name === v.name);
        if (!found) return [`Vault ${v.name} is absent.`];
        return v.items.filter((i: string) => !found.items.includes(i)).map((
          i: string,
        ) =>
          `${v.name}/${i} is declared but absent from the retained inventory.`
        );
      });
      const finding = mismatches.length
        ? mismatches.join(" ")
        : "Every declared vault/item exists in the retained inventory after reconciliation.";
      const declaration = inputs.find((e) => e.uri.endsWith("/Vaults.pkl"))!;
      return {
        questionId,
        state: {
          id: prefix,
          source: {
            uri: `${manifest.repository}/commit/${state.revision}`,
            origin: "historical",
            availability: "retained",
            immutableId: `git-commit:${state.revision}`,
            reason: null,
          },
          scope: [
            "Vaults contract, declarations, original expected PCF, referenced env/scripts and the captured inventory metadata.",
          ],
          inputs,
          image: gap(
            `${prefix}/image`,
            "The original CI container image was not retained.",
          ),
          snapshot: gap(
            `${prefix}/snapshot`,
            "No original container snapshot is available; the scoped files are retained individually.",
          ),
          limitations: [
            "Inventory describes the historical capture, not current vault contents.",
            "No secret values, live vault operations or application state are required.",
          ],
        },
        mutation: null,
        delivery: {
          feature: "vaults-contract",
          version: null,
          status: "planned",
          finding,
          scenario: "offline-vault-inventory",
          evidence: null,
        },
        declarations: [{
          text: "Every declared vault/item must actually exist in Proton Pass.",
          evidence: declaration,
          property: "missingDeclaredResources",
          declared: 0,
          observed: mismatches.length,
          observedFrom: observed,
        }],
        forecast: null,
        answer,
        observations: [
          observed,
          original.evidence,
          generated.evidence,
          baseline,
          checked.evidence,
          answerEvidence,
          gap(
            `${prefix}/original-check-output`,
            "Original CI assertion output is not retained in this bundle; these check outputs are new reproductions.",
          ),
        ],
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  const transitions = records.slice(1).map((r: any, index: number) => ({
    from: records[index].state.id,
    to: r.state.id,
    action:
      "Reconcile declarations and consumers with the retained observed topology, and regenerate the reviewable baseline.",
    finding: records[index].delivery.finding,
    evidence: [provenance, records[index].observations[0]],
  }));
  const execution = save(
    "execution.json",
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        pkl,
        runtime: Deno.version,
        command: [
          "deno",
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-run=pkl",
          "replay.ts",
          input,
          out,
        ],
        inventoryCapturedAt: manifest.inventory.capturedAt,
        trace: null,
      },
      null,
      2,
    ) + "\n",
  );
  records.forEach((r: any) => r.observations.push(execution));
  const capture = save(
    "capture.json",
    JSON.stringify({ questionId, records, transitions }, null, 2) + "\n",
  );
  const validated = execFileSync("pkl", [
    "eval",
    path.join(here, "Record.pkl"),
    "-p",
    `capture=${path.resolve(out, capture.uri)}`,
  ], { encoding: "utf8" });
  save("record.json", validated);
  return JSON.parse(validated);
}

if (import.meta.main) {
  if (Deno.args.length !== 2) {
    throw new Error(
      "usage: replay.ts <retained inputs directory> <fresh output directory>",
    );
  }
  replay(path.resolve(Deno.args[0]), path.resolve(Deno.args[1]));
}
