import { execFileSync } from "node:child_process";

/**
 * Self-heals before spending any agent turns if the local `dagger` CLI
 * doesn't match a running `dagger-engine-*` container (or a stale,
 * unreferenced `dagger-engine-*` image) on the shared host Docker daemon.
 * Confirmed live on 2026-09-06: a stale engine container left over from an
 * earlier version produced a GraphQL schema mismatch ("Cannot query field
 * 'name' on type 'TypeDef'") indistinguishable, from inside an agent run,
 * from a real module bug -- the worker spent ~37 tool calls trying to fix
 * it by editing dagger.json/go.mod before giving up, and the fix was never
 * in the module at all (`docker rm -f dagger-engine-v0.18.14`, letting
 * dagger reprovision a matching one).
 *
 * This used to throw and require a human to run that `docker rm -f` by
 * hand -- which meant every recurrence silently ate the worker's/
 * supervisor's entire run with no one watching. Root cause of the
 * recurrence: container-use environments share the host Docker socket, and
 * agents left to install their own `dagger` CLI (e.g. an unpinned `curl |
 * sh`) reliably drift to whatever is latest at the time, not the
 * `engineVersion` every bountybench-dagger-* module's dagger.json pins
 * (v0.21.8 as of this writing). Pinning new-environment setup commands
 * (`container-use config setup-command add ...`) only covers environments
 * created after the pin -- it can't stop an agent with Bash access from
 * reinstalling over it. So instead of trying to prevent drift at the
 * source, this now auto-remediates the shared symptom every time, per
 * standing approval to just delete-and-proceed on this exact class of
 * problem: remove the mismatched container(s) so dagger reprovisions a
 * matching one on next call, and prune the now-unreferenced mismatched
 * image(s) too (stale engine images were a contributor to a real disk-full
 * incident this session). A container/image removal failure still throws
 * -- that's a real Docker-daemon problem, not a version drift this
 * function can paper over.
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

  const pinnedName = `dagger-engine-v${cliVersion}`;

  let psOutput: string;
  try {
    psOutput = execFileSync(
      "docker",
      ["ps", "-a", "--filter", "name=dagger-engine", "--format", "{{.Names}}"],
      { encoding: "utf8" },
    );
  } catch (err) {
    throw new Error(`dagger-preflight: failed to run "docker ps" -- is Docker reachable? (${err})`);
  }

  const allEngines = psOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const mismatched = allEngines.filter((name) => name !== pinnedName);

  if (mismatched.length > 0) {
    console.error(
      `dagger-preflight: local dagger CLI is v${cliVersion}, but ${mismatched.join(", ")} ` +
        `is present on the shared Docker daemon -- this causes a GraphQL schema error ` +
        `("Cannot query field 'name' on type 'TypeDef'") that looks like a module bug but isn't. ` +
        `Auto-remediating: removing ${mismatched.join(", ")} so dagger reprovisions a matching engine.`,
    );
    try {
      execFileSync("docker", ["rm", "-f", ...mismatched], { encoding: "utf8" });
    } catch (err) {
      throw new Error(
        `dagger-preflight: found mismatched engine(s) ${mismatched.join(", ")} but failed to remove ` +
          `them (${err}) -- this is a real Docker-daemon problem, not a version drift this can paper over.`,
      );
    }
  }

  // Also prune any now-unreferenced dagger-engine images from other versions --
  // these don't break a run by themselves (only a running/stopped *container*
  // does), but left alone they're exactly the kind of disk bloat that caused
  // this session's disk-full incident. Best-effort: an image still in use by
  // something else (e.g. a concurrent run) will fail to remove and is left alone.
  try {
    const imagesOutput = execFileSync(
      "docker",
      ["images", "--filter", "reference=registry.dagger.io/engine", "--format", "{{.Repository}}:{{.Tag}}"],
      { encoding: "utf8" },
    );
    const staleImages = imagesOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((ref) => !ref.endsWith(`:v${cliVersion}`) && !ref.endsWith(":latest"));
    for (const image of staleImages) {
      try {
        execFileSync("docker", ["rmi", image], { encoding: "utf8" });
        console.error(`dagger-preflight: pruned stale engine image ${image}`);
      } catch {
        // still referenced somewhere -- leave it, not worth failing the run over.
      }
    }
  } catch {
    // `docker images` itself failing isn't fatal to this preflight -- the
    // container-level check above is the one that actually gates correctness.
  }
}
