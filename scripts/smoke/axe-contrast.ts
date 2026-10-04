/**
 * Shared axe colour-contrast seam for Playwright smoke specs (ROK-1472).
 *
 * Reused by the ROK-1203 theme audit, so it stays a seam — no route list, no
 * crawl, no report writing here.
 *
 * - `useLightScheme(page)` boots the app in a light theme through the same
 *   localStorage keys the theme store reads on start-up
 *   (web/src/stores/theme-helpers.ts). It must run BEFORE the first goto:
 *   setting `data-scheme` on <html> after render (as some older specs do)
 *   leaves Tailwind `dark:` variants and the store out of step with the page.
 *   It also pins the theme fields of `GET /users/me/preferences`: after login
 *   the app applies the server's saved theme over localStorage
 *   (web/src/hooks/use-theme-sync.ts), and the smoke user's saved theme is
 *   shared, mutable state, so without the pin a page could re-render in the
 *   dark scheme mid-test.
 * - `expectLightScheme(page, scheme?)` proves the boot path took effect.
 * - `waitForFiniteAnimations(page)` waits until no finite CSS animation or
 *   transition is mid-flight, so axe never measures a half-faded element.
 * - `expectNoContrastViolations(page)` runs the axe `color-contrast` rule on
 *   the whole page and fails with one line per offending node.
 *
 * Never narrow the scan (`exclude`, `include`, `disableRules`) to make a route
 * pass — that hides exactly what this check exists to catch. The only escape
 * hatch is `known`: a CSS selector the reported element must match plus the
 * exact colour pair, for a violation that waits on a recorded operator decision.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from './base';

/** localStorage keys mirrored from web/src/stores/theme-helpers.ts. */
export const THEME_MODE_KEY = 'raid_ledger_theme_mode';
export const LIGHT_THEME_KEY = 'raid_ledger_light_theme';

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type Violation = AxeResults['violations'][number];
type ViolationNode = Violation['nodes'][number];

/** The `data` axe attaches to a failed color-contrast check. */
interface ContrastData {
    fgColor?: string;
    bgColor?: string;
    contrastRatio?: number;
    expectedContrastRatio?: string;
}

/** Matches the preferences read however the API base path is mounted. */
export const PREFERENCES_ROUTE = '**/users/me/preferences';

/** A violation allowed until a recorded decision lands: element AND colours must match. */
export interface KnownContrastViolation {
    /**
     * A CSS selector the reported element itself must match (`Element.matches`
     * in the page). Not axe's generated selector string: axe emits whatever is
     * unique in that DOM (`a[href$="community-lineup/3"]`, `.shadow-x`,
     * `div:nth-child(3) > …`), so the string changes with the seed while the
     * element does not.
     */
    target: string;
    fg: string;
    bg: string;
}

/** Whether the element axe reported at `axeTarget` matches the CSS selector `selector`. */
export type KnownMatcher = (axeTarget: string, selector: string) => boolean;

/** Override only the theme fields of a `{ data: prefs }` preferences body. */
export function pinLightPreferences(body: unknown, lightThemeId: string): unknown {
    if (typeof body !== 'object' || body === null) return body;
    const data = (body as { data?: unknown }).data;
    if (typeof data !== 'object' || data === null) return body;
    return { ...body, data: { ...data, themeMode: 'light', lightTheme: lightThemeId } };
}

/** Boot every later navigation of `page` in the given light theme. */
export async function useLightScheme(
    page: Page,
    lightThemeId = 'default-light',
): Promise<void> {
    await page.route(PREFERENCES_ROUTE, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const json = pinLightPreferences(await response.json(), lightThemeId);
        await route.fulfill({ response, json });
    });
    await page.addInitScript(
        ([modeKey, themeKey, themeId]) => {
            localStorage.setItem(modeKey, 'light');
            localStorage.setItem(themeKey, themeId);
        },
        [THEME_MODE_KEY, LIGHT_THEME_KEY, lightThemeId] as const,
    );
}

/**
 * Assert the page actually rendered in the light scheme. `default-light` (and
 * quest-log) render as `data-scheme="light"`; a tinted light theme renders as
 * its own id (SUB_THEME_CONFIG in web/src/stores/theme-helpers.ts), so pass it.
 */
export async function expectLightScheme(page: Page, scheme = 'light'): Promise<void> {
    await expect(page.locator('html')).toHaveAttribute('data-scheme', scheme);
}

/** Wait until every finite animation/transition has finished. */
export async function waitForFiniteAnimations(page: Page): Promise<void> {
    await page.waitForFunction(() =>
        document.getAnimations().every((animation) => {
            const timing = animation.effect?.getComputedTiming();
            const endless = timing?.iterations === Infinity;
            return endless || animation.playState !== 'running';
        }),
    );
}

function contrastData(node: ViolationNode): ContrastData {
    const check = [...node.any, ...node.all, ...node.none].find(
        (c) => c.id === 'color-contrast',
    );
    return (check?.data ?? {}) as ContrastData;
}

/** One readable line per node: selector, colours, measured vs needed ratio. */
export function formatContrastViolations(violations: Violation[]): string {
    const rows = violations.flatMap((v) =>
        v.nodes.map((node) => {
            const d = contrastData(node);
            const target = node.target.map(String).join(' >> ');
            return `  ${target} — fg ${d.fgColor ?? '?'} on bg ${d.bgColor ?? '?'} = ${d.contrastRatio ?? '?'}:1 (needs ${d.expectedContrastRatio ?? '?'})`;
        }),
    );
    if (rows.length === 0) return 'no color-contrast violations';
    return `${rows.length} color-contrast violation(s):\n${rows.join('\n')}`;
}

/** axe's selector for a top-document node; null for one inside a frame or shadow root. */
function topTarget(node: ViolationNode): string | null {
    const [first, ...rest] = node.target;
    return rest.length === 0 && typeof first === 'string' ? first : null;
}

/** Every distinct top-document selector axe reported. */
export function reportedTargets(violations: Violation[]): string[] {
    const targets = violations.flatMap((v) => v.nodes.map(topTarget));
    return [...new Set(targets.filter((t): t is string => t !== null))];
}

/**
 * For each axe selector, the `selectors` its element matches. Runs INSIDE the
 * page via `page.evaluate`, so it must stay self-contained (no imports, no
 * closures). An axe selector that resolves to nothing matches nothing.
 */
export function matchKnownSelectors(
    [targets, selectors]: readonly [string[], string[]],
): string[][] {
    return targets.map((target) => {
        const element = document.querySelector(target);
        return element ? selectors.filter((selector) => element.matches(selector)) : [];
    });
}

/** Turn `matchKnownSelectors` output back into a lookup. */
export function knownMatcherFrom(targets: string[], hits: string[][]): KnownMatcher {
    const byTarget = new Map(targets.map((target, i) => [target, hits[i] ?? []]));
    return (axeTarget, selector) => byTarget.get(axeTarget)?.includes(selector) ?? false;
}

function isKnown(node: ViolationNode, known: KnownContrastViolation[], matches: KnownMatcher): boolean {
    const d = contrastData(node);
    const target = topTarget(node);
    return target !== null && known.some((k) =>
        matches(target, k.target) && k.fg === d.fgColor && k.bg === d.bgColor);
}

/** Drop the nodes `known` accounts for; a violation left with no nodes is dropped too. */
export function withoutKnownViolations(
    violations: Violation[],
    known: KnownContrastViolation[],
    matches: KnownMatcher,
): Violation[] {
    return violations
        .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !isKnown(n, known, matches)) }))
        .filter((v) => v.nodes.length > 0);
}

/** Run axe's color-contrast rule on the whole page; fail listing every node not in `known`. */
export async function expectNoContrastViolations(
    page: Page,
    known: KnownContrastViolation[] = [],
): Promise<void> {
    const { violations } = await new AxeBuilder({ page })
        .withRules(['color-contrast'])
        .analyze();
    const targets = reportedTargets(violations);
    const hits = known.length > 0 && targets.length > 0
        ? await page.evaluate(matchKnownSelectors, [targets, known.map((k) => k.target)] as const)
        : [];
    const unexpected = withoutKnownViolations(violations, known, knownMatcherFrom(targets, hits));
    expect(unexpected, formatContrastViolations(unexpected)).toEqual([]);
}
