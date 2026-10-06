/**
 * ROK-1716: the admin WoW Forever namespace probe panel — last run, found
 * banner, collapsed candidate x region matrix, Run now, and the probe config.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ForeverProbeResultDto, ForeverProbeStateDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { ForeverProbePanel } from './forever-probe-panel';

const BASE = 'http://localhost:3000/admin/plugins/blizzard/forever-probe';

function makeResult(overrides: Partial<ForeverProbeResultDto> = {}): ForeverProbeResultDto {
    return {
        ranAt: '2026-11-04T12:00:00.000Z', durationMs: 4200, status: 'ok', candidates: ['classicforever', 'classic'],
        cells: [
            { prefix: 'classicforever', region: 'us', endpoint: 'realm', status: 404 },
            { prefix: 'classic', region: 'us', endpoint: 'realm', status: 200 },
            { prefix: 'classic', region: 'eu', endpoint: 'playable-race', status: null, error: 'timeout' },
        ],
        matches: [], shapes: {}, found: null, ...overrides,
    };
}

let state: ForeverProbeStateDto;
let runs = 0;
let puts: unknown[] = [];

beforeEach(() => {
    state = { result: null, extraCandidates: [], characterPath: null };
    runs = 0;
    puts = [];
    server.use(
        http.get(BASE, () => HttpResponse.json(state)),
        http.post(`${BASE}/run`, () => {
            runs += 1;
            state = { ...state, result: makeResult({ found: { prefix: 'classicforever', at: '2026-11-04T12:00:00.000Z' } }) };
            return HttpResponse.json(state.result);
        }),
        http.put(`${BASE}/config`, async ({ request }) => {
            const body = (await request.json()) as ForeverProbeStateDto;
            puts.push(body);
            state = { ...state, ...body };
            return HttpResponse.json(state);
        }),
    );
});

describe('ForeverProbePanel (ROK-1716)', () => {
    it('shows the never-run state with no banner and no matrix', async () => {
        renderWithProviders(<ForeverProbePanel />);
        expect(await screen.findByText(/probe has not run yet/i)).toBeInTheDocument();
        expect(screen.queryByText(/forever namespace found/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('shows the found banner and a matrix of status chips per candidate and region', async () => {
        state = { ...state, result: makeResult({ found: { prefix: 'classicforever', at: '2026-11-04T12:00:00.000Z' } }) };
        renderWithProviders(<ForeverProbePanel />);
        expect(await screen.findByText(/forever namespace found: classicforever/i)).toBeInTheDocument();
        const table = screen.getByRole('table', { hidden: true });
        const classicRow = within(table).getByRole('row', { name: /^classic\b/i, hidden: true });
        expect(within(classicRow).getByText('200')).toBeInTheDocument();
        expect(within(classicRow).getByText('err')).toBeInTheDocument();
        expect(within(classicRow).getByTitle('realm: 200')).toBeInTheDocument();
    });

    it('Run now POSTs and refreshes the panel with the fresh result', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverProbePanel />);
        await screen.findByText(/probe has not run yet/i);
        await user.click(screen.getByRole('button', { name: /run now/i }));
        expect(await screen.findByText(/forever namespace found: classicforever/i)).toBeInTheDocument();
        expect(runs).toBe(1);
        expect(screen.queryByText(/probe has not run yet/i)).not.toBeInTheDocument();
    });

    it('blocks an invalid extra candidate with an inline error and sends nothing', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverProbePanel />);
        const input = await screen.findByRole('textbox', { name: /extra candidates/i });
        await user.type(input, 'forever, Bad-Prefix');
        await user.click(screen.getByRole('button', { name: /save probe settings/i }));
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(puts).toEqual([]);
    });

    it('saves valid extra candidates and the character path', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverProbePanel />);
        await user.type(await screen.findByRole('textbox', { name: /extra candidates/i }), 'forever2, wowfe');
        await user.type(screen.getByRole('textbox', { name: /character path/i }), 'nightslayer/thrall');
        await user.click(screen.getByRole('button', { name: /save probe settings/i }));
        await waitFor(() => expect(puts).toEqual([{ extraCandidates: ['forever2', 'wowfe'], characterPath: 'nightslayer/thrall' }]));
    });
});
