import type { ObservedInventory } from './inventory.pkl';

/**
 * Real observed data, not invented: this repo's actual
 * `.dagger/internal/devenv-base/pkl/Vaults.test.pkl-expected.pcf` golden
 * snapshot, and the drift `Vaults.pkl`'s own header comment documents --
 * "claude" moved from vault "tidelands.dev" to vault "anthropic.ai" and
 * "linear-release" moved to vault "jingling057", both directly in Proton
 * Pass with no commit recording either move.
 *
 * Nobody hand-edits this file. In the real workflow it's captured by
 * `hk/capture-vault-inventory.sh` from the live account; here it's a
 * read-only fixture -- the file you're meant to edit in this lesson is
 * `declaredRequirement.ts`, not this one.
 */
export const observed: ObservedInventory = {
  vaults: [
    { name: 'tidelands.dev', items: ['agent.tidelands.dev', 'pass-cli'] },
    { name: 'anthropic.ai', items: ['claude'] },
    { name: 'jingling057', items: ['agent.tidelands.dev', 'linear-release'] },
    {
      name: 'infra',
      items: [
        'restic',
        'github.com',
        'tailscale',
        'render.com',
        'cloudflare',
        'dagger.cloud',
        'SSH-tidelane',
        'jules.googleapis.com',
        'netlify',
        'stitch.withgoogle.com',
        'tidelands-1.seahorse-saurolophus.ts.net',
      ],
    },
    { name: 'test', items: ['cit-96'] },
  ],
};

/**
 * Vaults.test.pkl's own `examples { ["observed vault names"] { ... } }`
 * golden snapshot, copied verbatim from `Vaults.test.pkl-expected.pcf`.
 * "api.linear.app" appears here with no corresponding `VaultSpec` in
 * `Vaults.pkl` at all -- an observed vault nobody has declared a need for.
 * Per `Vaults.pkl`'s own header, that's expected: "This is a decision, not
 * a transcription of `pass-cli vault list` output" -- observed state is
 * always allowed to carry more than any one declaration accounts for.
 */
export const observedVaultNames = ['anthropic.ai', 'api.linear.app', 'infra', 'jingling057', 'test', 'tidelands.dev'];
