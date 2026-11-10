/**
 * ROK-1717: the admin WoW Forever section in the Blizzard integration card —
 * namespace prefix (validated client-side) + the Armory-import switch.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import {
    renderWithProviders,
    createTestQueryClient,
} from '../../../test/render-helpers';
import { foreverQuestImportHandlers } from '../../../test/mocks/forever-quest-import-handlers';
import { ForeverSettingsSection } from './forever-settings-section';

const URL = 'http://localhost:3000/admin/plugins/blizzard/forever';
const DEFAULT_CONFIG = {
    namespacePrefix: 'classicforever',
    namespacePrefixIsDefault: true,
    armoryImportEnabled: false,
};

let puts: unknown[] = [];

beforeEach(() => {
    puts = [];
    server.use(
        ...foreverQuestImportHandlers,
        http.get(URL, () => HttpResponse.json(DEFAULT_CONFIG)),
        http.get(`${URL}-probe`, () =>
            HttpResponse.json({
                result: null,
                extraCandidates: [],
                characterPath: null,
                guildPath: null,
            }),
        ),
        http.put(URL, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            puts.push(body);
            return HttpResponse.json({
                ...DEFAULT_CONFIG,
                ...body,
                namespacePrefixIsDefault: false,
            });
        }),
    );
});

const prefixInput = () =>
    screen.findByRole('textbox', { name: /namespace prefix/i });

const STATUS_URL = 'http://localhost:3000/system/status';

/** ROK-2163: the namespace diagnostics render only on DEMO_MODE sites. */
function serveDemoMode(): void {
    server.use(
        http.get(STATUS_URL, () =>
            HttpResponse.json({ status: 'ok', claimRequired: false, demoMode: true }),
        ),
    );
}

describe('ForeverSettingsSection (ROK-1717)', () => {
    it('saves the typed prefix with the current Armory flag', async () => {
        serveDemoMode();
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        const input = await prefixInput();
        expect(input).toHaveValue('classicforever');
        await user.clear(input);
        await user.type(input, 'classicfv2');
        await user.click(
            screen.getByRole('button', { name: /save forever settings/i }),
        );
        await waitFor(() =>
            expect(puts).toEqual([
                { namespacePrefix: 'classicfv2', armoryImportEnabled: false },
            ]),
        );
    });

    it('blocks an invalid prefix with an inline error and sends nothing', async () => {
        serveDemoMode();
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        const input = await prefixInput();
        await user.clear(input);
        await user.type(input, 'profile-Forever-us');
        await user.click(
            screen.getByRole('button', { name: /save forever settings/i }),
        );
        expect(
            await screen.findByText(/lowercase letters and digits only/i),
        ).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(puts).toEqual([]);
    });

    it('the Armory switch applies immediately with the saved prefix and refreshes the capabilities', async () => {
        const user = userEvent.setup();
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['blizzard', 'capabilities'], {
            armoryImport: { wow_forever: false },
        });
        renderWithProviders(<ForeverSettingsSection />, { queryClient });
        const toggle = await screen.findByRole('switch', {
            name: /armory import for wow forever/i,
        });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        await user.click(toggle);
        await waitFor(() =>
            expect(puts).toEqual([
                {
                    namespacePrefix: 'classicforever',
                    armoryImportEnabled: true,
                },
            ]),
        );
        await waitFor(() =>
            expect(
                queryClient.getQueryState(['blizzard', 'capabilities'])
                    ?.isInvalidated,
            ).toBe(true),
        );
    });
});

describe('ForeverSettingsSection probe panel (ROK-1716)', () => {
    beforeEach(serveDemoMode);
    it('renders the namespace probe panel inside the section', async () => {
        renderWithProviders(<ForeverSettingsSection />);
        expect(
            await screen.findByRole('heading', { name: /namespace probe/i }),
        ).toBeInTheDocument();
    });
});

/** ROK-1727: the Wowhead item resolver kill switch (unset ⇒ ON, D2). */
describe('ForeverSettingsSection — Wowhead item lookup switch (ROK-1727)', () => {
    it('reads unset as ON and turning it off PUTs wowheadResolverEnabled false with the other settings', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        const toggle = await screen.findByRole('switch', {
            name: /wowhead item lookup/i,
        });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        await user.click(toggle);
        await waitFor(() =>
            expect(puts).toEqual([
                {
                    namespacePrefix: 'classicforever',
                    armoryImportEnabled: false,
                    wowheadResolverEnabled: false,
                },
            ]),
        );
    });

    it('reads a saved false and keeps it when the Armory switch is flipped', async () => {
        server.use(
            http.get(URL, () =>
                HttpResponse.json({
                    ...DEFAULT_CONFIG,
                    wowheadResolverEnabled: false,
                }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        expect(
            await screen.findByRole('switch', { name: /wowhead item lookup/i }),
        ).toHaveAttribute('aria-checked', 'false');
        await user.click(
            screen.getByRole('switch', {
                name: /armory import for wow forever/i,
            }),
        );
        await waitFor(() =>
            expect(puts).toEqual([
                {
                    namespacePrefix: 'classicforever',
                    armoryImportEnabled: true,
                    wowheadResolverEnabled: false,
                },
            ]),
        );
    });
});

/** ROK-2102: `forever` is the default; the status line reads the latest probe result. */
describe('ForeverSettingsSection — namespace status (ROK-2102)', () => {
    beforeEach(serveDemoMode);
    const FOREVER_CONFIG = { ...DEFAULT_CONFIG, namespacePrefix: 'forever' };
    const probeState = (matchPrefix: string | null) => ({
        result: {
            ranAt: '2026-11-06T21:36:00.000Z',
            durationMs: 1200,
            status: 'ok',
            candidates: ['forever', 'classicforever'],
            cells: [],
            shapes: {},
            found: matchPrefix
                ? { prefix: matchPrefix, at: '2026-11-06T21:36:00.000Z' }
                : null,
            matches: matchPrefix
                ? [
                      {
                          prefix: matchPrefix,
                          region: 'us',
                          raceName: 'High Order Skyborne',
                          signal: 'skyborne',
                      },
                  ]
                : [],
        },
        extraCandidates: [],
        characterPath: null,
        guildPath: null,
    });

    it('shows forever as the prefix placeholder', async () => {
        renderWithProviders(<ForeverSettingsSection />);
        expect(await prefixInput()).toHaveAttribute('placeholder', 'forever');
    });

    it('says live when the latest probe matched the configured prefix', async () => {
        server.use(
            http.get(URL, () => HttpResponse.json(FOREVER_CONFIG)),
            http.get(`${URL}-probe`, () =>
                HttpResponse.json(probeState('forever')),
            ),
        );
        renderWithProviders(<ForeverSettingsSection />);
        const line = await screen.findByText(
            (_, el) =>
                el?.tagName === 'P' &&
                /^Forever namespace: live — prefix forever$/.test(
                    el.textContent ?? '',
                ),
        );
        expect(line).toBeInTheDocument();
        expect(
            screen.queryByText(
                (_, el) =>
                    el?.tagName === 'P' &&
                    /^Forever namespace: not confirmed/.test(
                        el.textContent ?? '',
                    ),
            ),
        ).not.toBeInTheDocument();
    });

    it('says not confirmed when the probe matched a different prefix than the configured one', async () => {
        server.use(
            http.get(URL, () =>
                HttpResponse.json({
                    ...DEFAULT_CONFIG,
                    namespacePrefix: 'xyz',
                }),
            ),
            http.get(`${URL}-probe`, () =>
                HttpResponse.json(probeState('forever')),
            ),
        );
        renderWithProviders(<ForeverSettingsSection />);
        const line = await screen.findByText(
            (_, el) =>
                el?.tagName === 'P' &&
                el.textContent ===
                    'Forever namespace: not confirmed — prefix xyz. Run the probe below.',
        );
        expect(line).toBeInTheDocument();
        expect(
            screen.queryByText(
                (_, el) =>
                    el?.tagName === 'P' &&
                    /^Forever namespace: live/.test(el.textContent ?? ''),
            ),
        ).not.toBeInTheDocument();
    });

    it('says not confirmed when no probe match has the configured prefix', async () => {
        server.use(
            http.get(URL, () => HttpResponse.json(FOREVER_CONFIG)),
            http.get(`${URL}-probe`, () =>
                HttpResponse.json(probeState('classic2x')),
            ),
        );
        renderWithProviders(<ForeverSettingsSection />);
        const line = await screen.findByText(
            (_, el) =>
                el?.tagName === 'P' &&
                el.textContent ===
                    'Forever namespace: not confirmed — prefix forever. Run the probe below.',
        );
        expect(line).toBeInTheDocument();
    });
});

describe('ForeverSettingsSection quest import (ROK-2143)', () => {
    it('renders the quest import panel under the namespace probe', async () => {
        renderWithProviders(<ForeverSettingsSection />);
        expect(await screen.findByRole('button', { name: 'Re-import quests' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Dungeon quest data' })).toBeInTheDocument();
    });
});

/** ROK-2143: the Forever quest import kill switch (unset ⇒ ON). */
describe('ForeverSettingsSection — quest import switch (ROK-2143)', () => {
    const questSwitch = () =>
        screen.findByRole('switch', { name: /quest import from the blizzard api/i });

    it('reads unset as ON and turning it off PUTs questImportEnabled false with the other settings', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        const toggle = await questSwitch();
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        await user.click(toggle);
        await waitFor(() =>
            expect(puts).toEqual([
                {
                    namespacePrefix: 'classicforever',
                    armoryImportEnabled: false,
                    questImportEnabled: false,
                },
            ]),
        );
    });

    it('reads a saved false and keeps it when the Armory switch is flipped', async () => {
        server.use(
            http.get(URL, () =>
                HttpResponse.json({ ...DEFAULT_CONFIG, questImportEnabled: false }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        expect(await questSwitch()).toHaveAttribute('aria-checked', 'false');
        await user.click(
            screen.getByRole('switch', { name: /armory import for wow forever/i }),
        );
        await waitFor(() =>
            expect(puts).toEqual([
                {
                    namespacePrefix: 'classicforever',
                    armoryImportEnabled: true,
                    questImportEnabled: false,
                },
            ]),
        );
    });
});

/** ROK-2163: diagnostics are hidden on prod and shown only on DEMO_MODE sites. */
/** Count GETs of the probe state; returns a reader for the count. */
function countProbeGets(): () => number {
    let count = 0;
    server.use(
        http.get(`${URL}-probe`, () => {
            count += 1;
            return HttpResponse.json({
                result: null,
                extraCandidates: [],
                characterPath: null,
                guildPath: null,
            });
        }),
    );
    return () => count;
}

describe('ForeverSettingsSection — DEMO_MODE-only diagnostics (ROK-2163)', () => {
    const neededControls = async (): Promise<void> => {
        expect(
            await screen.findByRole('switch', { name: /armory import for wow forever/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('switch', { name: /quest import from the blizzard api/i }),
        ).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: /wowhead item lookup/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'WoW Forever' })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Re-import quests' })).toBeInTheDocument();
    };

    const expectNoDiagnostics = (): void => {
        expect(screen.queryByRole('textbox', { name: /namespace prefix/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /namespace probe/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /run now/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/^Forever namespace:/)).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: /extra candidates/i })).not.toBeInTheDocument();
    };

    it('hides the diagnostics once system status says demoMode is false', async () => {
        server.use(
            http.get(STATUS_URL, () =>
                HttpResponse.json({ status: 'ok', claimRequired: false, demoMode: false }),
            ),
        );
        const queryClient = createTestQueryClient();
        renderWithProviders(<ForeverSettingsSection />, { queryClient });
        await neededControls();
        await waitFor(() =>
            expect(queryClient.getQueryState(['system', 'status'])?.status).toBe('success'),
        );
        expectNoDiagnostics();
    });

    it('never requests the probe state when demoMode is false', async () => {
        const probeGets = countProbeGets();
        server.use(
            http.get(STATUS_URL, () =>
                HttpResponse.json({ status: 'ok', claimRequired: false, demoMode: false }),
            ),
        );
        const queryClient = createTestQueryClient();
        renderWithProviders(<ForeverSettingsSection />, { queryClient });
        await neededControls();
        await waitFor(() =>
            expect(queryClient.getQueryState(['system', 'status'])?.status).toBe('success'),
        );
        expect(probeGets()).toBe(0);
    });

    it('requests the probe state when demoMode is true (spy control)', async () => {
        const probeGets = countProbeGets();
        serveDemoMode();
        renderWithProviders(<ForeverSettingsSection />);
        await waitFor(() => expect(probeGets()).toBeGreaterThan(0));
    });

    it('hides the diagnostics while system status is still loading', async () => {
        server.use(
            http.get(STATUS_URL, async () => {
                await delay('infinite');
                return HttpResponse.json({});
            }),
        );
        const queryClient = createTestQueryClient();
        renderWithProviders(<ForeverSettingsSection />, { queryClient });
        await neededControls();
        expect(queryClient.getQueryState(['system', 'status'])?.status).toBe('pending');
        expectNoDiagnostics();
    });

    it('shows the diagnostics next to the needed controls when demoMode is true', async () => {
        serveDemoMode();
        renderWithProviders(<ForeverSettingsSection />);
        await neededControls();
        expect(await prefixInput()).toBeInTheDocument();
        expect(
            await screen.findByRole('heading', { name: /namespace probe/i }),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /run now/i })).toBeInTheDocument();
        expect(await screen.findByText(/^Forever namespace:/)).toBeInTheDocument();
    });
});
