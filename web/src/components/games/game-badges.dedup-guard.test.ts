/**
 * ROK-1314 AC5 / AC6 — anti-drift source guards for the universal badge module.
 *
 * These are SOURCE-INTROSPECTION tests (same tier as
 * `web/src/styles/badge-overlay.test.ts`): they read the .tsx files as text and
 * assert the duplicated badge implementations listed in spec §1.2–§1.4 are gone.
 *
 * Why source-grep rather than render assertions: AC5/AC6 are about there being
 * exactly ONE implementation, which is a property of the source tree, not of a
 * rendered DOM. A render test can prove a badge appears; it cannot prove a
 * second copy of it does not exist three files over. This is precisely the
 * regression ROK-1314 exists to prevent (four price treatments, four ownership
 * treatments), so the guard lives at the level the drift happens.
 *
 * TDD: written before the implementation. Every assertion below FAILS on the
 * pre-implementation tree.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Repo-relative `web/src` root, resolved from this file's location. */
const WEB_SRC = resolve(__dirname, '../..');

function srcPath(relative: string): string {
    return resolve(WEB_SRC, relative);
}

function readSource(relative: string): string {
    const path = srcPath(relative);
    if (!existsSync(path)) {
        throw new Error(`Expected source file to exist: ${relative}`);
    }
    return readFileSync(path, 'utf-8');
}

/**
 * Names of every locally-declared function/const component in a source file.
 * Matches `function Foo(` and `const Foo = (` / `const Foo: X = (` forms.
 */
function localComponentNames(source: string): string[] {
    const names: string[] = [];
    const fnRe = /^\s*(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/gm;
    const constRe = /^\s*(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*[:=]/gm;
    for (const re of [fnRe, constRe]) {
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) names.push(match[1]);
    }
    return names;
}

/**
 * Every badge subcomponent CommonGroundGameCard defines locally today
 * (spec §1.2 #2, §1.3 #1, §1.4). All must move to the shared module.
 */
/**
 * Strip comments before scanning. These guards document the OLD broken values
 * in prose right next to the fix, so a naive scan flags the explanation
 * itself — which has now caught this file out twice: once on the legibility
 * fills, once on a comment that legitimately names the locked `On Sale`
 * wording. Match code, never commentary.
 */
const codeOnly = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const COMMON_GROUND_LOCAL_BADGES = [
    'AiBadge',
    'OwnerBadge',
    'WishlistBadge',
    'SaleBadge',
    'PlayerBadge',
    'EarlyAccessBadge',
];

// ---------------------------------------------------------------------------
// AC6 — exactly one price-badge implementation
// ---------------------------------------------------------------------------

describe('ROK-1314 AC6 — one price-badge implementation', () => {
    it('no file under web/src mentions SaleBadge or DealBadge', () => {
        // `git grep` keeps the search scoped to tracked sources (no dist/, no
        // node_modules) and is deterministic across machines. Exit code 1 means
        // "no matches", which is the passing state.
        let matches: string;
        try {
            matches = execFileSync(
                'git',
                ['grep', '-n', '-E', 'SaleBadge|DealBadge', '--', 'web/src'],
                { cwd: resolve(WEB_SRC, '../..'), encoding: 'utf-8' },
            );
        } catch (err) {
            // git grep exits 1 with empty stdout when nothing matched.
            matches = (err as { stdout?: string }).stdout ?? '';
        }
        // This test file itself references the strings inside a regex; exclude it.
        const offenders = matches
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .filter((line) => !line.includes('game-badges.dedup-guard.test.ts'));
        expect(offenders).toEqual([]);
    });

    it('PriceBadge is the sole price component: getPriceBadgeType + the two locked labels + opt-in showPrice', () => {
        const priceBadge = readSource('components/games/PriceBadge.tsx');
        expect(priceBadge).toMatch(/getPriceBadgeType/);
        // Spec §0 vocabulary lock — the two labels are the only price wording.
        expect(priceBadge).toMatch(/Best Price/);
        expect(priceBadge).toMatch(/On Sale/);
        // Spec §5.2 — opt-in price figure, appended without changing the label.
        expect(priceBadge).toMatch(/showPrice/);
    });

    it('price-badge.helpers exposes the scalar entry point and getPriceBadgeType delegates to it', () => {
        const helpers = readSource('components/games/price-badge.helpers.ts');
        expect(helpers).toMatch(/export function getPriceBadgeTypeFromScalars/);
        // Delegation, not a fork: getPriceBadgeType must CALL the scalar rule.
        const getPriceBadgeTypeBody = helpers.slice(
            helpers.indexOf('export function getPriceBadgeType('),
        );
        expect(getPriceBadgeTypeBody).toMatch(/getPriceBadgeTypeFromScalars\s*\(/);
    });
});

// ---------------------------------------------------------------------------
// AC5 — no local badge subcomponents left on any surface
// ---------------------------------------------------------------------------

describe('ROK-1314 AC5 — CommonGroundGameCard has no local badge subcomponents', () => {
    const source = () => readSource('components/lineups/CommonGroundGameCard.tsx');

    it.each(COMMON_GROUND_LOCAL_BADGES)(
        'does not declare a local %s component',
        (name) => {
            expect(localComponentNames(source())).not.toContain(name);
        },
    );

    it('renders the shared GameBadgeRow instead', () => {
        expect(source()).toMatch(/GameBadgeRow/);
    });
});

describe('ROK-1314 AC5 — lineups/GameInfoBadges.tsx is deleted', () => {
    it('the file no longer exists', () => {
        expect(existsSync(srcPath('components/lineups/GameInfoBadges.tsx'))).toBe(
            false,
        );
    });

    it('nothing imports GameInfoBadges', () => {
        let matches: string;
        try {
            matches = execFileSync(
                'git',
                ['grep', '-n', 'GameInfoBadges', '--', 'web/src'],
                { cwd: resolve(WEB_SRC, '../..'), encoding: 'utf-8' },
            );
        } catch (err) {
            matches = (err as { stdout?: string }).stdout ?? '';
        }
        const offenders = matches
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .filter((line) => !line.includes('game-badges.dedup-guard.test.ts'));
        expect(offenders).toEqual([]);
    });
});

describe('ROK-1314 AC5 — NominationCard drops its bespoke ownership + sale treatments', () => {
    const source = () => readSource('components/lineups/NominationCard.tsx');

    it('no ownershipBadgeClass helper', () => {
        expect(source()).not.toMatch(/ownershipBadgeClass/);
    });

    it('no hardcoded inline "On Sale" span', () => {
        // The literal must not appear in NominationCard's CODE — the label now
        // comes from the shared PriceBadge (spec §0 vocabulary lock). Comments
        // may legitimately name the locked wording when explaining why.
        expect(codeOnly(source())).not.toMatch(/On Sale/);
    });

    it('renders the shared GameBadgeRow', () => {
        expect(source()).toMatch(/GameBadgeRow/);
    });
});

describe('ROK-1314 AC5 — AiSuggestionCard drops OwnershipPill and its local AiBadge', () => {
    const source = () => readSource('components/lineups/AiSuggestionCard.tsx');

    it('does not declare a local OwnershipPill', () => {
        expect(localComponentNames(source())).not.toContain('OwnershipPill');
    });

    it('does not declare a local AiBadge', () => {
        expect(localComponentNames(source())).not.toContain('AiBadge');
    });

    it('imports AiBadge from the shared games badge module (spec §5.4 extraction-only)', () => {
        expect(source()).toMatch(/game-badges/);
    });
});

// ---------------------------------------------------------------------------
// AC5 — the shared module exists and is importable by downstream stories
// (spec §11 risk 5: ROK-1452 must be able to reuse these components)
// ---------------------------------------------------------------------------

describe('ROK-1314 — shared game-badges module surface', () => {
    it('web/src/components/games/game-badges.tsx exists', () => {
        expect(existsSync(srcPath('components/games/game-badges.tsx'))).toBe(true);
    });

    it.each([
        'OwnerBadge',
        'YouOwnBadge',
        'WishlistBadge',
        'YouWishlistedBadge',
        'PlayerBadge',
        'EarlyAccessBadge',
        'AiBadge',
        'GameBadgeRow',
    ])('exports %s', (name) => {
        const source = readSource('components/games/game-badges.tsx');
        // Either a direct declaration or a re-export from the split file
        // (spec §5.1 allows splitting the row logic into game-badge-row.tsx as
        // long as this module stays the single import path).
        expect(source).toMatch(new RegExp(`\\b${name}\\b`));
    });

    it('re-exports PriceBadge and CoopPill rather than re-implementing them', () => {
        const source = readSource('components/games/game-badges.tsx');
        expect(source).toMatch(/PriceBadge/);
        expect(source).toMatch(/CoopPill/);
    });

    it('game-badges.helpers.ts exposes one adapter per DTO (spec §5.3)', () => {
        const helpers = readSource('components/games/game-badges.helpers.ts');
        for (const adapter of [
            'fromCommonGroundGame',
            'fromLineupEntry',
            'fromGameDetail',
            'fromVetoGameCard',
        ]) {
            expect(helpers).toMatch(new RegExp(`export function ${adapter}\\b`));
        }
    });
});


// ---------------------------------------------------------------------------
// ROK-1314 follow-up — badge legibility over cover art (operator report
// 2026-09-01: "the text on these new universal badges is hard to read").
//
// The badge row sits ON the cover image. A low-opacity fill takes the
// luminance of whatever artwork is behind it, so a translucent badge can
// measure ~1:1 against a bright cover and vanish, while looking perfectly fine
// on dark art. Measured before the fix: `You wishlisted` 1.02:1, genre 1.31:1
// (WCAG AA for bold text is 3.0:1).
//
// These pin the RULE (an opaque fill), not a specific colour — a palette
// change is fine, reintroducing a see-through badge over artwork is not.
// ---------------------------------------------------------------------------

describe('ROK-1314 — badge fills stay legible over cover art', () => {
    const OPACITY_RE = /bg-([a-z]+)-(\d{2,3})\/(\d{1,3})/g;


    it('every badge fill in the shared module is at least 90% opaque', () => {
        const source = codeOnly(readSource('components/games/game-badges.tsx'));
        const tooSheer: string[] = [];
        for (const [match, , , alpha] of source.matchAll(OPACITY_RE)) {
            if (Number(alpha) < 90) tooSheer.push(match);
        }
        expect(tooSheer).toEqual([]);
    });

    it('the personalized wishlist pill is an opaque fill, not a tint + border', () => {
        const source = codeOnly(readSource('components/games/game-badges.tsx'));
        const badge = source.slice(source.indexOf('export function YouWishlistedBadge'));
        const cls = badge.slice(0, badge.indexOf('</span>'));
        // A light fill needs DARK text; the old form paired a 20% fill with
        // amber-300 text on both layers, which is what made it disappear.
        expect(cls).not.toMatch(/bg-amber-300\/(?:[1-8]?\d)\b/);
        expect(cls).toMatch(/text-amber-950|text-black|text-\w+-9\d{2}/);
    });

    it('the genre badge does not use a see-through white fill over artwork', () => {
        const source = codeOnly(readSource('components/games/game-card-parts.tsx'));
        const badge = source.slice(source.indexOf('export function GenreBadge'));
        const cls = badge.slice(0, badge.indexOf('</span>'));
        expect(cls).not.toMatch(/bg-white\/[1-5]?\d\b/);
    });
});
