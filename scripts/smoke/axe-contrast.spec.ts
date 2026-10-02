/**
 * Unit tests for the axe colour-contrast failure message (ROK-1472).
 * The browser half of axe-contrast.ts runs in light-contrast.smoke.spec.ts;
 * this pins the part a red run is read through: one line per node naming the
 * selector, both colours and the measured vs required ratio.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./base', () => ({ expect: vi.fn() }));
vi.mock('@axe-core/playwright', () => ({ default: class {} }));

import {
    formatContrastViolations,
    knownMatcherFrom,
    matchKnownSelectors,
    pinLightPreferences,
    reportedTargets,
    withoutKnownViolations,
} from './axe-contrast';

type Violations = Parameters<typeof formatContrastViolations>[0];

function node(target: string[], data: Record<string, unknown> | undefined) {
    const check = { id: 'color-contrast', data };
    return { target, any: data ? [check] : [], all: [], none: [] };
}

function violations(...nodes: ReturnType<typeof node>[]): Violations {
    return [{ id: 'color-contrast', nodes }] as unknown as Violations;
}

describe('formatContrastViolations', () => {
    it('says so when there is nothing to report', () => {
        expect(formatContrastViolations([])).toBe('no color-contrast violations');
    });

    it('lists every node with selector, colours and measured vs required ratio', () => {
        const msg = formatContrastViolations(
            violations(
                node(['.text-dim'], {
                    fgColor: '#64748b',
                    bgColor: '#e2e8f0',
                    contrastRatio: 3.86,
                    expectedContrastRatio: '4.5:1',
                }),
                node(['#main', 'span.badge'], {
                    fgColor: '#047857',
                    bgColor: '#dcebe7',
                    contrastRatio: 4.35,
                    expectedContrastRatio: '4.5:1',
                }),
            ),
        );
        expect(msg).toBe(
            [
                '2 color-contrast violation(s):',
                '  .text-dim — fg #64748b on bg #e2e8f0 = 3.86:1 (needs 4.5:1)',
                '  #main >> span.badge — fg #047857 on bg #dcebe7 = 4.35:1 (needs 4.5:1)',
            ].join('\n'),
        );
    });

    it('still names the node when axe attached no contrast data', () => {
        const msg = formatContrastViolations(violations(node(['p.note'], undefined)));
        expect(msg).toContain('  p.note — fg ? on bg ? = ?:1 (needs ?)');
    });
});

describe('withoutKnownViolations', () => {
    const fill = { fgColor: '#ffffff', bgColor: '#009966', contrastRatio: 3.65 };
    const lineupCta = { target: 'a[href^="/community-lineup/"]', fg: '#ffffff', bg: '#009966' };

    /** The in-page matcher, run against jsdom's document instead of a browser page. */
    function domMatcher(v: Violations, known: { target: string }[]) {
        const targets = reportedTargets(v);
        return knownMatcherFrom(targets, matchKnownSelectors([targets, known.map((k) => k.target)]));
    }

    function remaining(v: Violations, known: (typeof lineupCta)[]): string {
        return formatContrastViolations(withoutKnownViolations(v, known, domMatcher(v, known)));
    }

    beforeEach(() => {
        document.body.innerHTML = [
            '<a href="/community-lineup/3" class="bg-emerald-600">View Lineup</a>',
            '<button class="bg-emerald-600 text-white">Start Lineup</button>',
        ].join('');
    });

    it('drops the node by what the element is, whatever selector string axe generated for it', () => {
        // axe picks the shortest unique selector for the DOM it saw: on one seed
        // `a[href="/community-lineup/38"]`, on another `a[href$="community-lineup/3"]`.
        const v = violations(node(['a[href$="community-lineup/3"]'], fill));
        expect(remaining(v, [lineupCta]), 'a pattern entry must survive any seed').toBe('no color-contrast violations');
    });

    it('keeps a matching element when its colours differ from the recorded pair', () => {
        const v = violations(node(['a[href$="community-lineup/3"]'], { ...fill, bgColor: '#10b981' }));
        expect(remaining(v, [lineupCta])).toContain('a[href$="community-lineup/3"] — fg #ffffff on bg #10b981');
    });

    it('keeps a node with the recorded colours whose element does not match', () => {
        const v = violations(node(['button.text-white'], fill));
        expect(remaining(v, [lineupCta])).toContain('button.text-white — fg #ffffff on bg #009966');
    });

    it('keeps a node axe reported inside a frame or shadow root, or that no longer resolves', () => {
        const v = violations(
            node(['iframe', 'a[href^="/community-lineup/"]'], fill),
            node(['a[href="/community-lineup/99"]'], fill),
        );
        expect(remaining(v, [lineupCta])).toMatch(/^2 color-contrast violation\(s\):/);
    });
});

describe('pinLightPreferences', () => {
    it('forces the theme fields to light and keeps every other preference', () => {
        const body = { data: { themeMode: 'dark', lightTheme: 'quest-log', timezone: 'UTC' } };
        expect(pinLightPreferences(body, 'default-light')).toEqual({
            data: { themeMode: 'light', lightTheme: 'default-light', timezone: 'UTC' },
        });
    });

    it('passes a body without a data object through unchanged', () => {
        expect(pinLightPreferences({ error: 'nope' }, 'default-light')).toEqual({ error: 'nope' });
        expect(pinLightPreferences(null, 'default-light')).toBeNull();
    });
});
