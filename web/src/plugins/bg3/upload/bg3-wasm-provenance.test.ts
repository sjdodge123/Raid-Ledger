/**
 * ROK-1960 L1 (spec D-3) — the vendored `.wasm` is exactly the artifact
 * PROVENANCE.json pins. Re-vendor with `node scripts/vendor-bg3-wasm.mjs
 * <pkgDir> <commitSha>`; never hand-edit either side to make this pass.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import provenance from './vendor/PROVENANCE.json';

const VENDOR = resolve(dirname(fileURLToPath(import.meta.url)), 'vendor');

describe('rl-collectors-web vendor provenance', () => {
    it('the .wasm sha256 matches PROVENANCE.json', () => {
        const wasm = readFileSync(resolve(VENDOR, 'rl_collectors_web_bg.wasm'));
        expect(createHash('sha256').update(wasm).digest('hex')).toBe(provenance.sha256);
    });

    it('pins a full commit, the rl-companion repo and a semver crate version', () => {
        expect(provenance.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(provenance.repo).toBe('github.com/Raid-Ledger-Plugins/rl-companion');
        expect(provenance.crateVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });
});
