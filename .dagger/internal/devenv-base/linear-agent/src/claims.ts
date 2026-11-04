import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Claims an event for processing, once, across restarts. Linear (and the
 * toolbox relay, which re-sends after an ambiguous failure) can deliver the
 * same event more than once, and every delivery would otherwise start another
 * Claude run. The claim is a file created exclusively, so the first caller
 * wins; later callers get false. It is at-most-once: if the process dies
 * after claiming and before finishing, the event is not run again (the user
 * prompts the session again). A claim that cannot be written throws, so the
 * delivery fails visibly and can be retried rather than run unrecorded.
 */
export function claimEvent(key: string): boolean {
  const dir = process.env.LINEAR_AGENT_STATE_DIR || join(homedir(), ".linear-agent", "claims");
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, createHash("sha256").update(key).digest("hex")), key, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}
