/**
 * ROK-1774/ROK-1830 — core never imports ANY plugin's code.
 *
 * The calendar draws Pelican's server schedule through the generic host API
 * (`web/src/plugins/calendar-layer.ts`, `PluginHandle.registerCalendarLayer`);
 * the guild hub reaches a game's parts through `plugins/hub-module.ts`. This
 * guard reads the SOURCE of every shipped file under `components/`, `pages/`
 * and of every host API module (the loose `plugins/*.ts(x)` files), and fails
 * on any import, re-export or dynamic import whose specifier has a `pelican`
 * path segment (ROK-1774) or reaches into `plugins/<slug>/` for ANY plugin
 * slug (ROK-1830 — core was importing `plugins/wow/hub/character-link` from
 * `components/hub/events`).
 *
 * Specifiers are RESOLVED against the importing file first (ROK-1830 r2), so a
 * host API module re-exporting `./wow/…` is caught the same as a core file
 * writing `../../plugins/wow/…`. The host API modules themselves are what core
 * is SUPPOSED to import, so only a specifier landing inside a plugin's own
 * directory offends.
 *
 * The allowlist is keyed by `(file, specifier)` pair, not by file (ROK-1830
 * r2): an exempt file adding a SECOND plugin import still fails, and a
 * `pelican` specifier is never exempt.
 *
 * Comments are stripped first (`stripComments`), so prose that mentions the
 * plugin's folder — like this header — passes (the ROK-1314 trap).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './form-primitives-count';

/** Resolved from THIS file, not the cwd — vitest runs from `web/`. */
const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED_ROOTS = ['components', 'pages'];

/** `from '…'`, `import '…'`, `import('…')` and `require('…')` specifiers. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]([^'"`]+)['"`]/g;

function isShippedSource(entry: string): boolean {
    return /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry);
}

/** Every shipped, non-test `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return isShippedSource(entry) ? [full] : [];
    });
}

/**
 * Core files that already reached into a plugin folder before ROK-1830 widened
 * this guard: the EXACT specifier each one is still allowed, with its reason.
 * These are pre-existing debt, NOT a licence for new ones — delete an entry the
 * moment its import is gone; the stale-entry test below enforces that.
 */
export const ALLOWLIST: Record<string, Record<string, string>> = {
    'components/shared/RoleIcon.tsx': {
        '../../plugins/wow/lib/role-icons': 'ROK-1830 debt: role icons are not WoW-only; they need a host API.',
    },
    'components/roster/SelectableCharacterCard.tsx': {
        '../../plugins/wow/lib/class-icons': 'ROK-1830 debt: class icons need a host API.',
        '../../plugins/wow/components/ProfessionBadges': 'ROK-1830 debt: profession badges need a slot.',
    },
    'components/events/player-card.tsx': {
        '../../plugins/wow/lib/class-icons': 'ROK-1830 debt: class icons need a host API.',
    },
    'components/events/shared/game-details-section.tsx': {
        '../../../plugins/wow/utils': 'ROK-1830 debt: getWowVariant/getContentType need a host API.',
    },
    'components/characters/character-card-compact.tsx': {
        '../../plugins/wow/lib/class-icons': 'ROK-1830 debt: class icons need a host API.',
        '../../plugins/wow/components/ProfessionBadges': 'ROK-1830 debt: profession badges need a slot.',
    },
    'pages/invite/invite-character-step.tsx': {
        '../../plugins/wow/components/wow-armory-import-form': 'ROK-1830 debt: the armory form should arrive through a plugin slot.',
    },
};

/** The host API modules: every loose, shipped `plugins/*.ts(x)` file (ROK-1776/ROK-1830 r2). */
export function hostApiFiles(): string[] {
    const dir = join(WEB_SRC, 'plugins');
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isShippedSource(entry.name))
        .map((entry) => join(dir, entry.name));
}

/** Every plugin's own folder under `web/src/plugins` — the slugs core must not reach into. */
export function pluginSlugs(): string[] {
    return readdirSync(join(WEB_SRC, 'plugins'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
}

/** Import/re-export/dynamic-import specifiers, comments stripped first. */
export function specifiersOf(source: string): string[] {
    return [...stripComments(source).matchAll(SPECIFIER)].map((m) => m[1] ?? '').filter(Boolean);
}

/**
 * The specifier as a path relative to `web/src`. A relative specifier is
 * resolved against `fromDir` (also relative to `web/src`) so `./wow/x` written
 * inside `plugins/` is seen as `plugins/wow/x`; anything else (bare or aliased)
 * is read as written.
 */
export function specifierParts(fromDir: string, specifier: string): string[] {
    if (!specifier.startsWith('.')) return specifier.split('/');
    return relative(WEB_SRC, resolve(WEB_SRC, fromDir, specifier)).split('/');
}

export function isPelicanSpecifier(fromDir: string, specifier: string): boolean {
    return specifierParts(fromDir, specifier).includes('pelican');
}

/** Lands in `plugins/<slug>/…`; `plugins/hub-module` and friends are the host API. */
export function isPluginFolderSpecifier(fromDir: string, specifier: string, slugs: readonly string[]): boolean {
    const parts = specifierParts(fromDir, specifier);
    return parts.some((part, i) => part === 'plugins' && slugs.includes(parts[i + 1] ?? ''));
}

export interface BoundaryHit {
    /** Path relative to `web/src`. */
    file: string;
    specifier: string;
    /** A `pelican` segment — never exempt, whatever the allowlist says. */
    pelican: boolean;
}

function hitsIn(file: string, source: string, slugs: readonly string[]): BoundaryHit[] {
    const fromDir = dirname(file);
    return specifiersOf(source)
        .filter((s) => isPelicanSpecifier(fromDir, s) || isPluginFolderSpecifier(fromDir, s, slugs))
        .map((specifier) => ({ file, specifier, pelican: isPelicanSpecifier(fromDir, specifier) }));
}

export function boundaryHits(): BoundaryHit[] {
    const slugs = pluginSlugs();
    return [...SCANNED_ROOTS.flatMap((root) => sourceFiles(join(WEB_SRC, root))), ...hostApiFiles()]
        .flatMap((full) => hitsIn(relative(WEB_SRC, full), readFileSync(full, 'utf8'), slugs));
}

/** Only a plugin-folder hit on an exactly-allowlisted `(file, specifier)` pair is exempt. */
export function isAllowed(hit: BoundaryHit): boolean {
    return !hit.pelican && ALLOWLIST[hit.file]?.[hit.specifier] !== undefined;
}

const label = (hit: BoundaryHit): string => `${hit.file} → ${hit.specifier}`;

describe('plugin core boundary guard (ROK-1774/ROK-1830)', () => {
    it('strips comments before scanning: prose passes, imports fail', () => {
        const dir = 'components/hub';
        expect(specifiersOf("// see plugins/pelican/register.ts\n/* from '../plugins/pelican' */ const a = 1;")).toEqual([]);
        expect(isPelicanSpecifier(dir, '../../plugins/pelican/calendar/use-items')).toBe(true);
        expect(isPelicanSpecifier(dir, './pelican')).toBe(true);
        expect(isPelicanSpecifier(dir, './pelican/register')).toBe(true);
        expect(isPelicanSpecifier(dir, '../plugins/pelican/hooks')).toBe(true);
        expect(isPelicanSpecifier(dir, './pelican-servers.helpers')).toBe(false);
        expect(specifiersOf("const label = 'pelican';")).toEqual([]);
    });

    it('every plugin folder is a banned import target, the host API files are not', () => {
        const slugs = pluginSlugs();
        const dir = 'components/hub/events';
        expect(slugs).toEqual(expect.arrayContaining(['pelican', 'wow']));
        expect(isPluginFolderSpecifier(dir, '../../../plugins/wow/hub/character-link', slugs)).toBe(true);
        expect(isPluginFolderSpecifier(dir, '../../plugins/wow/guild/guild-addons', slugs)).toBe(true);
        expect(isPluginFolderSpecifier(dir, '../plugins/ai/panel', slugs)).toBe(true);
        expect(specifiersOf("// import { x } from '../plugins/wow/hub/raids-bits';")).toEqual([]);
        expect(isPluginFolderSpecifier(dir, '../../plugins/hub-module', slugs)).toBe(false);
        expect(isPluginFolderSpecifier(dir, '../../plugins/plugin-registry', slugs)).toBe(false);
        expect(specifiersOf("const base = '/plugins/wow/guilds/7';")).toEqual([]);
    });

    it('a relative specifier is resolved before the plugin folder is decided (ROK-1830 r2)', () => {
        const slugs = pluginSlugs();
        // A host API module re-exporting its own neighbour folder: `./wow/…` IS `plugins/wow/…`.
        expect(isPluginFolderSpecifier('plugins', './wow/hub/character-link', slugs)).toBe(true);
        expect(isPluginFolderSpecifier('plugins', './pelican/calendar/use-items', slugs)).toBe(true);
        expect(isPelicanSpecifier('plugins', './pelican/calendar/use-items')).toBe(true);
        expect(isPluginFolderSpecifier('plugins', './hub-module', slugs)).toBe(false);
        expect(specifierParts('plugins', './wow/hub/x')).toEqual(['plugins', 'wow', 'hub', 'x']);
    });

});

describe('plugin core boundary scan (ROK-1774/ROK-1830)', () => {
    it('every host API module is part of the scan, plugin folders are not', () => {
        const scanned = hostApiFiles().map((file) => relative(WEB_SRC, file));
        expect(scanned).toContain('plugins/calendar-layer.ts');
        expect(scanned).toContain('plugins/game-server-status.ts');
        expect(scanned).toContain('plugins/hub-module.ts');
        expect(scanned).toContain('plugins/plugin-registry.ts');
        expect(scanned.filter((file) => file.split('/').length > 2)).toEqual([]);
    });

    it('the allowlist exempts one exact specifier, not a whole file (ROK-1830 r2)', () => {
        const file = 'components/shared/RoleIcon.tsx';
        expect(isAllowed({ file, specifier: '../../plugins/wow/lib/role-icons', pelican: false })).toBe(true);
        // A second plugin import from the SAME allowlisted file is still a failure.
        expect(isAllowed({ file, specifier: '../../plugins/wow/lib/class-icons', pelican: false })).toBe(false);
        expect(isAllowed({ file, specifier: '../../plugins/pelican/calendar/use-items', pelican: true })).toBe(false);
        // …and the whole-file scan agrees: the extra import shows up as an unexempt hit.
        const extra = hitsIn(file, "import { a } from '../../plugins/wow/lib/role-icons';\nimport { b } from '../../plugins/pelican/x';", pluginSlugs());
        expect(extra.filter((hit) => !isAllowed(hit)).map(label)).toEqual([`${file} → ../../plugins/pelican/x`]);
    });

    it('no core component, page or host API file imports plugin code', () => {
        const offenders = boundaryHits().filter((hit) => !isAllowed(hit)).map(label);
        expect(
            offenders,
            'Core must reach a plugin only through a host API file (plugins/calendar-layer.ts, '
                + 'plugins/hub-module.ts, plugins/game-server-status.ts) or a plugin slot — never by importing '
                + `plugins/<slug>/… directly. Offending imports: ${offenders.join(', ')}`,
        ).toEqual([]);
    });

    it('every allowlisted import still exists (a stale entry must be deleted)', () => {
        const hits = new Set(boundaryHits().map(label));
        const stale = Object.entries(ALLOWLIST)
            .flatMap(([file, specifiers]) => Object.keys(specifiers).map((specifier) => `${file} → ${specifier}`))
            .filter((pair) => !hits.has(pair));
        expect(stale, `Allowlist entries no longer needed — delete them: ${stale.join(', ')}`).toEqual([]);
    });
});
