/**
 * ROK-2143 — the probe matrix renders one chip per probed id for per-id
 * endpoints (quest, item): distinct React keys and the id in the chip.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ForeverProbeResultDto } from '@raid-ledger/contract';
import { ForeverProbeMatrix } from './forever-probe-matrix';

const result: ForeverProbeResultDto = {
    ranAt: '2026-11-08T12:00:00.000Z',
    durationMs: 1000,
    status: 'ok',
    candidates: ['forever'],
    cells: [
        { prefix: 'forever', region: 'us', endpoint: 'realm', status: 200 },
        { prefix: 'forever', region: 'us', endpoint: 'quest', status: 200, target: 'quest:378' },
        { prefix: 'forever', region: 'us', endpoint: 'quest', status: 404, target: 'quest:166' },
    ],
    matches: [],
    shapes: {},
    found: null,
};

describe('ForeverProbeMatrix per-id chips (ROK-2143)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('renders two quest chips with distinct keys, each naming its quest id', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<ForeverProbeMatrix result={result} />);
        const keyWarnings = errors.mock.calls.filter((c) => String(c[0]).includes('same key'));
        expect(keyWarnings).toEqual([]);
        expect(screen.getByTitle('quest:378: 200')).toHaveTextContent('378:200');
        expect(screen.getByTitle('quest:166: 404')).toHaveTextContent('166:404');
        expect(screen.getByTitle('realm: 200')).toHaveTextContent(/^200$/);
    });

    it('renders the match list inside the collapsed Probe matrix, not above it (ROK-2163)', () => {
        render(
            <ForeverProbeMatrix
                result={{
                    ...result,
                    matches: [{ prefix: 'forever', region: 'us', signal: 'ruleset' }],
                }}
            />,
        );
        const list = screen.getByRole('list', { name: 'Probe matches', hidden: true });
        expect(list).toHaveTextContent('forever/us: ruleset index');
        const details = list.closest('details');
        expect(details?.querySelector('summary')).toHaveTextContent('Probe matrix (3 checks)');
        expect(details).not.toHaveAttribute('open');
    });
});
