/**
 * ROK-1875 — nothing docked above the phone bottom bar may sit under the raised
 * centre Hubs circle (operator: "make sure the bottom tray all stay mobile
 * friendly").
 *
 * The circle lifts 24px (`-top-6`) above the 56px (`h-14`) bar, so the bar's
 * effective top is 3.5rem + 1.5rem + the safe-area inset. That one value lives
 * in `index.css` as `--bottom-nav-clearance`; every element that docks above
 * the bar uses it instead of the bare bar height. This guard reads the SOURCE
 * (comments stripped first, the ROK-1314 trap) so a new `bottom-[calc(3.5rem…`
 * dock, or a page padding that only clears the flat bar, fails here.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './form-primitives-count';

/** Resolved from THIS file, not the cwd — vitest runs from `web/`. */
const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED_ROOTS = ['components', 'pages', 'plugins'];

/** A dock/padding that clears only the flat 3.5rem bar, not the circle above it. */
const BANNED: RegExp[] = [/bottom-\[calc\(3\.5rem/, /\bpb-20 md:pb-/];

/** Every shipped, non-test `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        if (!/\.tsx?$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) return [];
        return [full];
    });
}

/** The comment-stripped source of a file under `web/src`. */
function source(path: string): string {
    return stripComments(readFileSync(join(WEB_SRC, path), 'utf8'));
}

describe('bottom-nav clearance (ROK-1875)', () => {
    it('index.css defines the clearance as bar height + circle raise + safe-area inset', () => {
        const css = readFileSync(join(WEB_SRC, 'index.css'), 'utf8');
        expect(css).toContain('--bottom-nav-height: 3.5rem;');
        expect(css).toContain('--bottom-nav-raise: 1.5rem;');
        expect(css).toContain('--bottom-nav-clearance: calc(var(--bottom-nav-height) + var(--bottom-nav-raise) + env(safe-area-inset-bottom));');
    });

    it('the variable matches the bar and the circle it describes (h-14 bar, -top-6 circle)', () => {
        expect(source('components/layout/bottom-tab-bar.tsx'), 'bar height changed — update --bottom-nav-height').toContain('h-14');
        expect(source('components/layout/hub-nav/hubs-circle.tsx'), 'circle raise changed — update --bottom-nav-raise').toContain('absolute -top-6');
    });

    it.each([
        'components/features/game-time/SelectedBlockInspector.tsx',
        'components/features/game-time/phone/DayBlockEditor.tsx',
        'components/layout/Layout.tsx',
        'components/hub/arrange/arrange-footer.tsx',
    ])('%s docks above the circle via --bottom-nav-clearance', (path) => {
        expect(source(path)).toContain('var(--bottom-nav-clearance)');
    });

    it('the hub page also pads past a tab\'s Filters FAB (ROK-1889)', () => {
        const css = readFileSync(join(WEB_SRC, 'index.css'), 'utf8');
        expect(css).toContain(':root:has([data-filter-fab]) { --filter-fab-clearance: 9rem; }');
        expect(css).toContain(':root:has([data-filter-fab]) { --filter-fab-clearance: 9.75rem; }');
        expect(source('components/hub/hub-page-error.tsx')).toContain('var(--filter-fab-clearance)');
        expect(source('components/layout/Layout.tsx'), 'the shell pads past a phone Filters FAB').toContain('var(--filter-fab-clearance)');
    });

    // ROK-2156: pages were cut off on phones because only ~8 of 74 padded past the bar.
    // The shell's <main> now owns that clearance (except where the bar does not render),
    // so a page adding it again would double it.
    it('the shell <main> owns the phone bar + Filters FAB clearance (ROK-2156)', () => {
        const layout = source('components/layout/Layout.tsx');
        expect(layout).toContain("const MAIN_TAB_BAR_CLEARANCE = 'pb-[max(calc(var(--bottom-nav-clearance)+1rem),var(--filter-fab-clearance))] md:pb-0';");
        expect(layout, 'main pads unless the bar is hidden').toContain("<main id=\"main-content\" className={hidesBottomTabBar(pathname) ? 'flex-1' : `flex-1 ${MAIN_TAB_BAR_CLEARANCE}`}>");
        expect(source('components/layout/bottom-tab-bar.tsx'), 'the bar and the shell share one hidden-route rule').toContain('if (hidesBottomTabBar(location.pathname)) return null;');
    });

    it('no page pads its own bottom past the bar — the shell already does (ROK-2156)', () => {
        const pagePad = /\bpb-\[[^\]\s'"`]*--bottom-nav-clearance/;
        const offenders = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(WEB_SRC, root)))
            .filter((file) => !file.endsWith(join('components', 'layout', 'Layout.tsx')))
            .filter((file) => pagePad.test(stripComments(readFileSync(file, 'utf8'))))
            .map((file) => relative(WEB_SRC, file));
        expect(offenders, 'drop the page padding; Layout.tsx <main> clears the bar').toEqual([]);
    });

    // ROK-2132 moved the hub page's `PAGE` padding into `hub-page-error.tsx`; every
    // render path — the body, each notice, the skeleton and a module's join gate —
    // must still wrap in that one class string, so the tablet FAB clearance applies
    // everywhere. The phone bar clearance is the shell's (ROK-2156), never PAGE's.
    it('every hub-page render path wraps in the one PAGE padding (ROK-2132)', () => {
        const owner = source('components/hub/hub-page-error.tsx');
        expect(owner).toMatch(/export const PAGE = '[^;]*md:pb-\[max\(2rem,var\(--filter-fab-clearance\)\)\]/);
        expect(owner, 'PAGE must not re-add the shell bar clearance').not.toContain('--bottom-nav-clearance');
        expect(owner, 'Notice pads past the bar').toMatch(/function Notice\b[\s\S]*?<div className=\{PAGE\}>/);
        expect(owner, 'the loading skeleton pads past the bar').toMatch(/function LoadingState\b[\s\S]*?<div className=\{PAGE\}/);
        expect(owner, "a module's join gate pads past the bar").toMatch(/<div className=\{PAGE\}><Gate\b/);
        const page = source('components/hub/hub-page.tsx');
        expect(page).toMatch(/import \{[^}]*\bPAGE\b[^}]*\} from '\.\/hub-page-error';/);
        expect(page, 'the hub body pads past the bar').toContain('<div className={PAGE}>');
        expect(page, 'hub-page.tsx must not re-declare its own page padding').not.toMatch(/\bconst PAGE\b/);
    });

    it('no shipped file docks or pads against the flat bar height', () => {
        const offenders = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(WEB_SRC, root)))
            .filter((file) => BANNED.some((re) => re.test(stripComments(readFileSync(file, 'utf8')))))
            .map((file) => relative(WEB_SRC, file));
        expect(offenders, 'use var(--bottom-nav-clearance) so the raised Hubs circle covers nothing').toEqual([]);
    });
});
