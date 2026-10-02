/**
 * Unit tests for the axe colour-contrast failure message (ROK-1472).
 * The browser half of axe-contrast.ts runs in light-contrast.smoke.spec.ts;
 * this pins the part a red run is read through: one line per node naming the
 * selector, both colours and the measured vs required ratio.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./base', () => ({ expect: vi.fn() }));
vi.mock('@axe-core/playwright', () => ({ default: class {} }));

import { formatContrastViolations } from './axe-contrast';

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
