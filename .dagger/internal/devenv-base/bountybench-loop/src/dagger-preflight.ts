import { execFileSync } from "node:child_process";

/**
 * Aborts the run before spending any agent turns if the local `dagger` CLI
 * doesn't match a running `dagger-engine-*` container on the shared host
 * Docker daemon. Confirmed live on 2026-09-06: a stale engine container left
 * over from an earlier version produced a GraphQL schema mismatch
 * ("Cannot query field 'name' on type 'TypeDef'") indistinguishable, from
 * inside an agent run, from a real module bug -- the worker spent ~37 tool
 * calls trying to fix it by editing dagger.json/go.mod before giving up,
 * and the fix was never in the module at all (`docker rm -f
 * dagger-engine-v0.18.14`, letting dagger reprovision a matching one). Since
 * container-use environments share the host Docker socket, this isn't
 * scoped to one environment -- any environment can trip it, and any
 * environment's `dagger` CLI install can be the mismatched side. Failing
 * fast here turns that into a one-line, immediately-diagnosable error
 * instead of a burned agent run.
 */
export function checkDaggerEngineVersion(): void {
  let cliVersion: string;
  try {
    const versionOutput = execFileSync("dagger", ["version"], { encoding: "utf8" });
    const match = versionOutput.match(/dagger v(\S+)/);
    if (!match) {
      throw new Error(`could not parse "dagger version" output: ${versionOutput}`);
    }
    cliVersion = match[1];
  } catch (err) {
    throw new Error(`dagger-preflight: failed to run "dagger version" -- is dagger installed? (${err})`);
  }

  let psOutput: string;
  try {
    psOutput = execFileSync(
      "docker",
      ["ps", "--filter", "name=dagger-engine", "--format", "{{.Names}}"],
      { encoding: "utf8" },
    );
  } catch (err) {
    throw new Error(`dagger-preflight: failed to run "docker ps" -- is Docker reachable? (${err})`);
  }

  const runningEngines = psOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const mismatched = runningEngines.filter((name) => name !== `dagger-engine-v${cliVersion}`);

  if (mismatched.length > 0) {
    throw new Error(
      `dagger-preflight: version mismatch detected -- local dagger CLI is v${cliVersion}, but ` +
        `${mismatched.join(", ")} is running on the shared Docker daemon. This causes a GraphQL ` +
        `schema error ("Cannot query field 'name' on type 'TypeDef'") that looks like a module bug ` +
        `but isn't -- container-use environments share this host's Docker socket, so a stale engine ` +
        `from any prior run can break every module. Fix: docker rm -f ${mismatched.join(" ")} ` +
        `(dagger reprovisions a matching engine automatically on next call), then rerun. ` +
        `Aborting before spending any agent turns on this.`,
    );
  }
}
