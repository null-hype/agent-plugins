import { deepEqual, equal, match, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replay } from "./replay.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

Deno.test("restored scoped files reproduce drift and reconciliation through the shared record", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "vaults-transfer-test-"));
  try {
    // An unrelated directory and a copied bundle: no historical git checkout,
    // network access or live vault session is needed to regenerate the record.
    const bundle = path.join(temp, "restored");
    cpSync(path.join(here, "inputs"), path.join(bundle, "inputs"), {
      recursive: true,
    });
    cpSync(
      path.join(here, "manifest.json"),
      path.join(bundle, "manifest.json"),
    );
    const report = path.join(temp, "report");
    const record = replay(bundle, report);
    const retained = JSON.parse(
      readFileSync(path.join(here, "captured/record.json"), "utf8"),
    );
    deepEqual(
      record.records.map((
        r: any,
      ) => [r.state.id, r.answer, r.outcome, r.delivery.finding]),
      retained.records.map((
        r: any,
      ) => [r.state.id, r.answer, r.outcome, r.delivery.finding]),
    );
    deepEqual(record.records.map((r: any) => r.outcome), [
      "out-of-range",
      "in-range",
    ]);
    equal(record.records[0].declarations[0].declared, 0);
    equal(record.records[0].declarations[0].observed, 2);
    equal(record.records[1].declarations[0].observed, 0);
    equal(record.transitions[0].finding, record.records[0].delivery.finding);
    for (const r of record.records) {
      equal(r.forecast, null);
      equal(r.mutation, null);
      equal(r.state.image.availability, "missing");
      equal(r.observations[0].origin, "historical");
      equal(r.observations[4].origin, "reproduced");
      const baseline = `${r.state.id}/generated/Vaults.test.pkl-expected.pcf`;
      equal(
        readFileSync(path.join(report, baseline), "utf8"),
        readFileSync(path.join(here, "captured", baseline), "utf8"),
      );
    }
    // Every local retained evidence descriptor must resolve to the exact bytes
    // it identifies, including generated expected baselines and raw results.
    const verify = (v: any): void => {
      if (Array.isArray(v)) {
        v.forEach(verify);
        return;
      }
      if (!v || typeof v !== "object") return;
      if (
        v.availability === "retained" && v.immutableId?.startsWith("sha256:")
      ) {
        const bytes = readFileSync(path.join(report, v.uri));
        equal(
          v.immutableId,
          `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        );
      } else Object.values(v).forEach(verify);
    };
    verify(record);
    throws(() => replay(bundle, report), /must be empty/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

Deno.test("changed observations are refused before a checker is executed", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "vaults-tamper-test-"));
  try {
    const bundle = path.join(temp, "bundle");
    cpSync(path.join(here, "inputs"), path.join(bundle, "inputs"), {
      recursive: true,
    });
    cpSync(
      path.join(here, "manifest.json"),
      path.join(bundle, "manifest.json"),
    );
    writeFileSync(
      path.join(bundle, "inputs/vaults-observed.json"),
      '{"vaults":[]}',
    );
    throws(
      () => replay(bundle, path.join(temp, "report")),
      /retained input changed/,
    );
    equal(existsSync(path.join(temp, "report")), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

Deno.test("missing contract evidence is refused instead of becoming a passing answer", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "vaults-missing-test-"));
  try {
    const bundle = path.join(temp, "bundle");
    cpSync(path.join(here, "inputs"), path.join(bundle, "inputs"), {
      recursive: true,
    });
    cpSync(
      path.join(here, "manifest.json"),
      path.join(bundle, "manifest.json"),
    );
    const manifest = JSON.parse(
      readFileSync(path.join(bundle, "manifest.json"), "utf8"),
    );
    const contract = manifest.states[0].files.find((f: any) =>
      f.path.endsWith("/Vaults.test.pkl")
    );
    match(contract.blob, /^[0-9a-f]{40}$/);
    rmSync(path.join(bundle, contract.file));
    throws(() => replay(bundle, path.join(temp, "report")), /ENOENT/);
    equal(existsSync(path.join(temp, "report")), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
