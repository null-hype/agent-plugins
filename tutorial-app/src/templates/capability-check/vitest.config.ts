import { defineConfig } from 'vitest/config';

// Why package.json pins @rolldown/binding-wasm32-wasi, rolldown and vite:
// vitest 5 loads vite 8, which loads rolldown, which is a native (napi)
// addon WebContainer cannot execute. With no wasm binding in node_modules,
// rolldown's loader falls back to its WebContainer path -- it shells out to
// pnpm for @rolldown/binding-wasm32-wasi, then stamps the loaded binding as
// "native" even though the binding already stamped itself "wasm32-wasi", and
// the mismatch throws ERR_NAPI_BINDING_TARGET_CONFLICT before any test runs
// ("`__napiBindingTarget` is reserved by the generated binding loader").
// Installing the wasm binding as a real devDependency takes the loader's
// normal WASI branch instead, which labels it correctly. The binding must
// match rolldown's version exactly, and vite only pins rolldown to ~1.2.6,
// so rolldown and vite are pinned here (and in package-lock.json) to keep
// the three from drifting apart. Revisit once rolldown fixes the fallback.

// evaluations.jsonl is written by toHaveVerdict.ts's matcher, one record
// per call; globalSetup truncates it once per run (see its own comment),
// not on every watch-mode rerun.
// forceRerunTriggers (CIT-150): chapter-3 lesson 5 reads a worker fact
// file's text off disk at check time -- the same structural check
// capability-spike/reconcile/reconcile.go's factRoutesThroughGate does --
// so a .pkl the reader edits is never in vitest's module graph and watch
// mode would not notice it changed. The defaults are restated because
// setting this replaces them rather than adding to it. Harmless for the
// lessons that don't read a .pkl at runtime: nothing to rerun for.
export default defineConfig({
  test: {
    globalSetup: ['./vitest-global-setup.ts'],
    fileParallelism: false,
    forceRerunTriggers: [
      '**/package.json/**',
      '**/vitest.config.*/**',
      '**/vite.config.*/**',
      '**/worker/*.pkl',
    ],
  },
});
