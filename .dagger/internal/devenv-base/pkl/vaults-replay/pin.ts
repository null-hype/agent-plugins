// Maintainer-only acquisition. Replay itself never calls git, GitHub or pass-cli.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const base = ".dagger/internal/devenv-base/pkl";
const states = [
  "99e902df60f43ae8d9757ac138c92bf6aa78eb7f",
  "d9a581d8fcbabe81b61cf1417fb62dbbb38fb59b",
];
const hash = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
const inventory = readFileSync(path.join(here, "inputs/vaults-observed.json"));
const manifest = {
  repository: "https://github.com/null-hype/agent-plugins",
  inventory: {
    file: "inputs/vaults-observed.json",
    sha256: hash(inventory),
    origin: "historical",
    capturedAt: "2026-09-17T01:45:39Z",
    run: "https://github.com/null-hype/agent-plugins/actions/runs/35171754006",
    artifactId: 10477305436,
    archiveDigest:
      "sha256:fc80e74dadc1ec102258b242891fbfcc3b6d84c1fbb41d173b9878785efdf0b4",
  },
  states: states.map((revision, index) => {
    const test = git("show", `${revision}:${base}/Vaults.test.pkl`).toString();
    // All resource reads in this historical contract use quoted relative paths.
    // Preserve their repository paths, so the original module runs unmodified.
    const resources = [...test.matchAll(/"(\.\.\/[^"\n]+)"/g)]
      .map((m) => path.posix.normalize(`${base}/${m[1]}`))
      .filter((p) => !p.endsWith("/build/vaults-observed.json"));
    const paths = [
      ...new Set([
        `${base}/Vaults.pkl`,
        `${base}/Vaults.test.pkl`,
        `${base}/Vaults.test.pkl-expected.pcf`,
        ...resources,
      ]),
    ];
    return {
      id: index === 0 ? "before-reconciliation" : "after-reconciliation",
      revision,
      files: paths.map((name) => {
        if (name.startsWith("../") || path.isAbsolute(name)) {
          throw new Error(`resource escapes repository: ${name}`);
        }
        const bytes = git("show", `${revision}:${name}`);
        const file = `inputs/${index}/${name}`;
        mkdirSync(path.dirname(path.join(here, file)), { recursive: true });
        writeFileSync(path.join(here, file), bytes);
        return {
          path: name,
          file,
          blob: git("rev-parse", `${revision}:${name}`).toString().trim(),
          sha256: hash(bytes),
        };
      }),
    };
  }),
};
writeFileSync(
  path.join(here, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
