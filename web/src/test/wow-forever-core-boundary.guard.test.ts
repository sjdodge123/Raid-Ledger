/**
 * ROK-1733 — WoW: Forever identity lives in the WoW plugin, never in core.
 *
 * ROK-1721 shipped Forever slug checks and ruleset literals inside six core
 * components; ROK-1733 moved them behind the generic `useCharacterIdentity` /
 * `useCharacterLocationLabel` hooks (`web/src/plugins/character-identity.ts`).
 * This guard reads the SOURCE of every shipped file under `components/` and
 * `pages/` so the next Forever rule cannot quietly land in core again.
 *
 * Comments are stripped first (`stripComments`), so provenance prose that
 * names the game passes — this very header says the banned word and must not
 * fail its own test (the ROK-1314 trap).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './form-primitives-count';

/** Resolved from THIS file, not the cwd — vitest runs from `web/`. */
const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED_ROOTS = ['components', 'pages'];

/** The game's name/slug in any case, or a WoW: Forever-only ruleset as a string literal. */
const BANNED = [/forever/i, /['"`](roleplaying|hardcore)['"`]/];

/**
 * Files allowed to keep a match, each with its reason. Delete an entry the
 * moment its file is cleaned — the stale-entry test below enforces that.
 */
const ALLOWLIST: Record<string, string> = {
    'components/profile/CharacterCard.tsx': 'ROK-1563 variant label — ROK-1726 Lane B removes; delete this entry then',
    'components/characters/character-card-compact.tsx': 'ROK-1563 variant label — ROK-1726 Lane B removes; delete this entry then',
};

/** Every shipped, non-test `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        if (!/\.tsx?$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) return [];
        return [full];
    });
}

export function hasBannedLiteral(source: string): boolean {
    const code = stripComments(source);
    return BANNED.some((re) => re.test(code));
}

function filesWithBannedLiterals(): string[] {
    return SCANNED_ROOTS
        .flatMap((root) => sourceFiles(join(WEB_SRC, root)))
        .filter((file) => hasBannedLiteral(readFileSync(file, 'utf8')))
        .map((file) => relative(WEB_SRC, file));
}

describe('WoW: Forever core boundary guard (ROK-1733)', () => {
    it('strips comments before scanning: prose passes, code fails', () => {
        expect(hasBannedLiteral('// WoW: Forever note\n/* forever */ const a = 1;')).toBe(false);
        expect(hasBannedLiteral("const slug = 'world-of-warcraft-forever';")).toBe(true);
        expect(hasBannedLiteral("if (r === 'hardcore') return;")).toBe(true);
        expect(hasBannedLiteral("const r = 'pvp';")).toBe(false);
    });

    it('no core component or page names WoW: Forever outside the allowlist', () => {
        const offenders = filesWithBannedLiterals().filter((file) => !(file in ALLOWLIST));
        expect(
            offenders,
            'WoW: Forever identity belongs in web/src/plugins/wow — use useCharacterIdentity / useCharacterLocationLabel '
                + `from plugins/character-identity instead. Offending files: ${offenders.join(', ')}`,
        ).toEqual([]);
    });

    it('every allowlisted file still matches (a stale entry must be deleted)', () => {
        const hits = new Set(filesWithBannedLiterals());
        const stale = Object.keys(ALLOWLIST).filter((file) => !hits.has(file));
        expect(stale, `Allowlist entries no longer needed — delete them: ${stale.join(', ')}`).toEqual([]);
    });
});
