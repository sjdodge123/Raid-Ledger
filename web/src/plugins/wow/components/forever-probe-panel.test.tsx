/**
 * ROK-1716: the admin WoW Forever namespace probe panel — last run, found
 * banner, collapsed candidate x region matrix, Run now, and the probe config.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type {
    ForeverProbeResultDto,
    ForeverProbeStateDto,
} from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { ForeverProbePanel } from './forever-probe-panel';

const BASE = 'http://localhost:3000/admin/plugins/blizzard/forever-probe';

function makeResult(
    overrides: Partial<ForeverProbeResultDto> = {},
): ForeverProbeResultDto {
    return {
        ranAt: '2026-11-04T12:00:00.000Z',
        durationMs: 4200,
        status: 'ok',
        candidates: ['classicforever', 'classic'],
        cells: [
            {
                prefix: 'classicforever',
                region: 'us',
                endpoint: 'realm',
                status: 404,
            },
            { prefix: 'classic', region: 'us', endpoint: 'realm', status: 200 },
            {
                prefix: 'classic',
                region: 'eu',
                endpoint: 'playable-race',
                status: null,
                error: 'timeout',
            },
        ],
        matches: [],
        shapes: {},
        found: null,
        ...overrides,
    };
}

let state: ForeverProbeStateDto;
let runs = 0;
let puts: unknown[] = [];

beforeEach(() => {
    state = {
        result: null,
        extraCandidates: [],
        characterPath: null,
        guildPath: null,
    };
    runs = 0;
    puts = [];
    server.use(
        http.get(BASE, () => HttpResponse.json(state)),
        http.post(`${BASE}/run`, () => {
            runs += 1;
            state = {
                ...state,
                result: makeResult({
                    found: {
                        prefix: 'classicforever',
                        at: '2026-11-04T12:00:00.000Z',
                    },
                }),
            };
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
        expect(
            await screen.findByText(/probe has not run yet/i),
        ).toBeInTheDocument();
        expect(
            screen.queryByText(/forever namespace found/i),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('shows the found banner and a matrix of status chips per candidate and region', async () => {
        state = {
            ...state,
            result: makeResult({
                found: {
                    prefix: 'classicforever',
                    at: '2026-11-04T12:00:00.000Z',
                },
            }),
        };
        renderWithProviders(<ForeverProbePanel />);
        expect(
            await screen.findByText(/forever namespace found: classicforever/i),
        ).toBeInTheDocument();
        // ROK-2163: Armory is on by default now — the banner no longer says to enable it.
        expect(screen.queryByText(/enable armory/i)).not.toBeInTheDocument();
        const table = screen.getByRole('table', { hidden: true });
        const classicRow = within(table).getByRole('row', {
            name: /^classic\b/i,
            hidden: true,
        });
        expect(within(classicRow).getByText('200')).toBeInTheDocument();
        expect(within(classicRow).getByText('err')).toBeInTheDocument();
        expect(within(classicRow).getByTitle('realm: 200')).toBeInTheDocument();
        // The legend names only endpoints that were probed (profile is absent with no character path).
        expect(
            screen.getByText(/each cell: realm · playable-race status/i),
        ).toBeInTheDocument();
    });

    it('Run now POSTs and refreshes the panel with the fresh result', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverProbePanel />);
        await screen.findByText(/probe has not run yet/i);
        await user.click(screen.getByRole('button', { name: /run now/i }));
        expect(
            await screen.findByText(/forever namespace found: classicforever/i),
        ).toBeInTheDocument();
        expect(runs).toBe(1);
        expect(
            screen.queryByText(/probe has not run yet/i),
        ).not.toBeInTheDocument();
    });

    it('blocks an invalid extra candidate with an inline error and sends nothing', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverProbePanel />);
        const input = await screen.findByRole('textbox', {
            name: /extra candidates/i,
        });
        await user.type(input, 'forever, Bad-Prefix');
        await user.click(
            screen.getByRole('button', { name: /save probe settings/i }),
        );
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(puts).toEqual([]);
    });

    it('saves valid extra candidates and the character path', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverProbePanel />);
        await user.type(
            await screen.findByRole('textbox', { name: /extra candidates/i }),
            'forever2, wowfe',
        );
        await user.type(
            screen.getByRole('textbox', { name: /character path/i }),
            'nightslayer/thrall',
        );
        await user.click(
            screen.getByRole('button', { name: /save probe settings/i }),
        );
        await waitFor(() =>
            expect(puts).toEqual([
                {
                    extraCandidates: ['forever2', 'wowfe'],
                    characterPath: 'nightslayer/thrall',
                    guildPath: null,
                },
            ]),
        );
    });
});

describe('ForeverProbePanel — Forever API paths + ruleset signal (ROK-2102)', () => {
    it('accepts a realmless Forever character slug and sends it (ROK-2102)', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverProbePanel />);
        await user.type(
            await screen.findByRole('textbox', { name: /character path/i }),
            'thrall-stormborn',
        );
        await user.click(
            screen.getByRole('button', { name: /save probe settings/i }),
        );
        await waitFor(() =>
            expect(puts).toEqual([
                {
                    extraCandidates: [],
                    characterPath: 'thrall-stormborn',
                    guildPath: null,
                },
            ]),
        );
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('sends the guild path alongside the character path (ROK-2102)', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverProbePanel />);
        await user.type(
            await screen.findByRole('textbox', { name: /guild path/i }),
            'the-vanguard',
        );
        await user.click(
            screen.getByRole('button', { name: /save probe settings/i }),
        );
        await waitFor(() =>
            expect(puts).toEqual([
                {
                    extraCandidates: [],
                    characterPath: null,
                    guildPath: 'the-vanguard',
                },
            ]),
        );
    });

    it('blocks an invalid guild path with an inline error and sends nothing (ROK-2102)', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverProbePanel />);
        const input = await screen.findByRole('textbox', {
            name: /guild path/i,
        });
        await user.type(input, 'a/b/c');
        await user.click(
            screen.getByRole('button', { name: /save probe settings/i }),
        );
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(puts).toEqual([]);
    });

    it('renders a ruleset-signal match as "ruleset index" and a Skyborne match by race name (ROK-2102)', async () => {
        state = {
            ...state,
            result: makeResult({
                cells: [
                    {
                        prefix: 'classicforever',
                        region: 'us',
                        endpoint: 'ruleset',
                        status: 200,
                    },
                    {
                        prefix: 'classicforever',
                        region: 'us',
                        endpoint: 'profile-equipment',
                        status: 200,
                    },
                    {
                        prefix: 'classicforever',
                        region: 'us',
                        endpoint: 'guild-roster',
                        status: 404,
                    },
                ],
                matches: [
                    {
                        prefix: 'classicforever',
                        region: 'us',
                        raceName: null,
                        signal: 'ruleset',
                    },
                    {
                        prefix: 'classic',
                        region: 'eu',
                        raceName: 'Skyborne',
                        signal: 'skyborne',
                    },
                ],
            }),
        };
        renderWithProviders(<ForeverProbePanel />);
        expect(
            await screen.findByText(/classicforever\/us: ruleset index/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/classic\/eu: Skyborne$/)).toBeInTheDocument();
        expect(screen.queryByText(/Skyborne race/)).not.toBeInTheDocument();
        expect(
            screen.getByText(/each cell: ruleset · equip · guild status/i),
        ).toBeInTheDocument();
    });
    it('lists every response shape key with its top-level keys and entry count, never the sample (ROK-2102)', async () => {
        state = {
            ...state,
            result: makeResult({
                shapes: {
                    'classicforever:us:ruleset': {
                        topLevelKeys: ['_links', 'rulesets'],
                        entryCount: 3,
                        sample: [{ name: 'SecretSampleValue' }],
                    },
                    'classic:eu:guild-roster': {
                        topLevelKeys: ['guild', 'members'],
                        entryCount: 0,
                        sample: [],
                    },
                },
            }),
        };
        renderWithProviders(<ForeverProbePanel />);
        expect(
            await screen.findByText(/response shapes \(keys; values for quest \+ item data\)/i),
        ).toBeInTheDocument();
        const list = screen.getByRole('list', {
            name: /response shapes/i,
            hidden: true,
        });
        const items = within(list).getAllByRole('listitem', { hidden: true });
        expect(items.map((li) => li.textContent)).toEqual([
            'classic:eu:guild-roster: guild, members (entries: 0)',
            'classicforever:us:ruleset: _links, rulesets (entries: 3)',
        ]);
        expect(screen.queryByText(/SecretSampleValue/)).not.toBeInTheDocument();
    });

    it('renders no response shapes block when shapes is empty (ROK-2102)', async () => {
        state = { ...state, result: makeResult({ shapes: {} }) };
        renderWithProviders(<ForeverProbePanel />);
        await screen.findByText(/last run/i);
        expect(screen.queryByText(/response shapes/i)).not.toBeInTheDocument();
    });
});
