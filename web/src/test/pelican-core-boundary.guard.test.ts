/**
 * ROK-1774/ROK-1830 — core never imports ANY plugin's code.
 *
 * The calendar draws Pelican's server schedule through the generic host API
 * (`web/src/plugins/calendar-layer.ts`, `PluginHandle.registerCalendarLayer`);
 * the guild hub reaches a game's parts through `plugins/hub-module.ts`. This
 * guard reads the SOURCE of every shipped file under `components/`, `pages/`
 * and the host API files, and fails on any import, re-export or dynamic
 * import whose specifier has a `pelican` path segment (ROK-1774) or reaches
 * into `plugins/<slug>/` for ANY plugin slug (ROK-1830 — core was importing
 * `plugins/wow/hub/character-link` from `components/hub/events`).
 *
 * The host API modules themselves — the loose `plugins/*.ts(x)` files, e.g.
 * `plugins/hub-module.ts` — are what core is SUPPOSED to import, so only a
 * specifier naming a plugin's own directory offends.
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
 * this guard, each with its reason. These are pre-existing debt, NOT a licence
 * for new ones — delete an entry the moment its file is cleaned; the
 * stale-entry test below enforces that.
 */
const ALLOWLIST: Record<string, string> = {
    'components/shared/RoleIcon.tsx': 'ROK-1830 debt: wow/lib/role-icons needs a host API (role icons are not WoW-only).',
    'components/roster/SelectableCharacterCard.tsx': 'ROK-1830 debt: wow/lib/class-icons + wow ProfessionBadges need a slot.',
    'components/events/player-card.tsx': 'ROK-1830 debt: wow/lib/class-icons needs a host API.',
    'components/events/shared/game-details-section.tsx': 'ROK-1830 debt: wow/utils getWowVariant/getContentType need a host API.',
    'components/characters/character-card-compact.tsx': 'ROK-1830 debt: wow/lib/class-icons + wow ProfessionBadges need a slot.',
    'pages/invite/invite-character-step.tsx': 'ROK-1830 debt: WowArmoryImportForm should arrive through a plugin slot.',
};

const HOST_API_PREFIXES = ['calendar-layer', 'game-server-status'];

/** The host API files themselves: `plugins/calendar-layer*.ts(x)` and `plugins/game-server-status*.ts(x)` (ROK-1776). */
function hostApiFiles(): string[] {
    const dir = join(WEB_SRC, 'plugins');
    return readdirSync(dir)
        .filter((entry) => HOST_API_PREFIXES.some((p) => entry.startsWith(p)) && isShippedSource(entry))
        .map((entry) => join(dir, entry));
}

export function importsPelican(source: string): boolean {
    const code = stripComments(source);
    return [...code.matchAll(SPECIFIER)].some((m) => (m[1] ?? '').split('/').includes('pelican'));
}

/** Every plugin's own folder under `web/src/plugins` — the slugs core must not reach into. */
export function pluginSlugs(): string[] {
    return readdirSync(join(WEB_SRC, 'plugins'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
}

/** A specifier that walks into `plugins/<slug>/…`; `plugins/hub-module` and friends are the host API. */
export function importsPluginFolder(source: string, slugs: readonly string[]): boolean {
    const code = stripComments(source);
    return [...code.matchAll(SPECIFIER)].some((m) => {
        const parts = (m[1] ?? '').split('/');
        return parts.some((part, i) => part === 'plugins' && slugs.includes(parts[i + 1] ?? ''));
    });
}

function offendingFiles(): string[] {
    const slugs = pluginSlugs();
    return [...SCANNED_ROOTS.flatMap((root) => sourceFiles(join(WEB_SRC, root))), ...hostApiFiles()]
        .filter((file) => {
            const source = readFileSync(file, 'utf8');
            return importsPelican(source) || importsPluginFolder(source, slugs);
        })
        .map((file) => relative(WEB_SRC, file));
}

describe('plugin core boundary guard (ROK-1774/ROK-1830)', () => {
    it('strips comments before scanning: prose passes, imports fail', () => {
        expect(importsPelican("// see plugins/pelican/register.ts\n/* from '../plugins/pelican' */ const a = 1;")).toBe(false);
        expect(importsPelican("import { x } from '../../plugins/pelican/calendar/use-items';")).toBe(true);
        expect(importsPelican("export * from './pelican';")).toBe(true);
        expect(importsPelican("import './pelican/register';")).toBe(true);
        expect(importsPelican("const m = await import('../plugins/pelican/hooks');")).toBe(true);
        expect(importsPelican("import { x } from './pelican-servers.helpers';")).toBe(false);
        expect(importsPelican("const label = 'pelican';")).toBe(false);
    });

    it('every plugin folder is a banned import target, the host API files are not', () => {
        const slugs = pluginSlugs();
        expect(slugs).toEqual(expect.arrayContaining(['pelican', 'wow']));
        expect(importsPluginFolder("import { CharacterLink } from '../../../plugins/wow/hub/character-link';", slugs)).toBe(true);
        expect(importsPluginFolder("import { GuildAddons } from '../../plugins/wow/guild/guild-addons';", slugs)).toBe(true);
        expect(importsPluginFolder("const m = await import('../plugins/ai/panel');", slugs)).toBe(true);
        expect(importsPluginFolder("// import { x } from '../plugins/wow/hub/raids-bits';", slugs)).toBe(false);
        expect(importsPluginFolder("import type { HubModule } from '../../plugins/hub-module';", slugs)).toBe(false);
        expect(importsPluginFolder("import { clearRegistry } from '../../plugins/plugin-registry';", slugs)).toBe(false);
        expect(importsPluginFolder("const base = '/plugins/wow/guilds/7';", slugs)).toBe(false);
    });

    it('the host API files are part of the scan', () => {
        expect(hostApiFiles().map((file) => relative(WEB_SRC, file))).toContain('plugins/calendar-layer.ts');
        expect(hostApiFiles().map((file) => relative(WEB_SRC, file))).toContain('plugins/game-server-status.ts');
    });

    it('no core component, page or host API file imports plugin code', () => {
        const offenders = offendingFiles().filter((file) => !(file in ALLOWLIST));
        expect(
            offenders,
            'Core must reach a plugin only through a host API file (plugins/calendar-layer.ts, '
                + 'plugins/hub-module.ts, plugins/game-server-status.ts) or a plugin slot — never by importing '
                + `plugins/<slug>/… directly. Offending files: ${offenders.join(', ')}`,
        ).toEqual([]);
    });

    it('every allowlisted file still reaches into a plugin (a stale entry must be deleted)', () => {
        const hits = new Set(offendingFiles());
        const stale = Object.keys(ALLOWLIST).filter((file) => !hits.has(file));
        expect(stale, `Allowlist entries no longer needed — delete them: ${stale.join(', ')}`).toEqual([]);
    });
});
