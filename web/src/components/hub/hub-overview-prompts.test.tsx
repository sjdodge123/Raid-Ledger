/**
 * ROK-2153 review r1 MINOR 6 — §4.7 one banner at a time on the hub Overview:
 * while the claim prompt shows, the Companion prompt waits; once the claim
 * prompt is dismissed (or claimed), the Companion prompt shows as before.
 * Uses the real BG3 Companion registration plus a fake BG3 claim provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage, HubOnboardingStateDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { buildHubClaimStatus } from '../../test/mocks/hub-claim-handlers';
import { usePluginStore } from '../../stores/plugin-store';
import '../../plugins/bg3/register';
import { addHubClaimProvider, clearHubClaimProviders } from './claim/hub-claim-providers';
import { OverviewPrompts } from './hub-overview';

vi.mock('../../lib/companion-install', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/companion-install')>()),
    companionDownloadAvailable: () => true,
}));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000';
const ONBOARDING = `${API}/guilds/onboarding`;
const CLAIM = 'hub-claim-prompt';
const COMPANION = 'companion-install-prompt';

function page(): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind: 'game_community', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug: 'baldurs-gate-3' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function serve(): void {
    let state: HubOnboardingStateDto = { dismissed: [] };
    server.use(
        http.get(`${API}/companion/v1/devices`, () => HttpResponse.json({ data: [] })),
        http.get(`${API}/guilds/:id/claim`, () => HttpResponse.json(buildHubClaimStatus())),
        http.get(ONBOARDING, () => HttpResponse.json(state)),
        // Only the claim prompt is dismissed in these tests.
        http.post(`${ONBOARDING}/claim-character/dismiss`, () => {
            state = { dismissed: [...state.dismissed, { key: 'claim-character', guildId: 7, dismissedAt: '2026-11-10T00:00:00.000Z' }] };
            return HttpResponse.json(state);
        }),
    );
}

beforeEach(() => {
    usePluginStore.setState({ activeSlugs: new Set(['core', 'bg3']), initialized: true });
    addHubClaimProvider('bg3', { games: ['baldurs-gate-3'], kinds: ['game_community'] });
});
afterEach(() => { clearHubClaimProviders(); server.resetHandlers(); });

describe('Overview prompts — one banner at a time (§4.7)', () => {
    it('the claim prompt wins; dismissing it brings the Companion prompt back', async () => {
        serve();
        renderWithProviders(<OverviewPrompts ctx={{ page: page() }} />);
        expect(await screen.findByTestId(CLAIM)).toBeInTheDocument();
        expect(screen.queryByTestId(COMPANION)).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: "Dismiss: don't show this again" }));
        expect(await screen.findByTestId(COMPANION)).toBeInTheDocument();
        await waitFor(() => { expect(screen.queryByTestId(CLAIM)).toBeNull(); });
    });

    it('while the claim status is loading the Companion prompt waits, then shows when there is nothing to claim', async () => {
        serve();
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => { release = resolve; });
        let claimRequested = false;
        server.use(http.get(`${API}/guilds/:id/claim`, async () => {
            claimRequested = true;
            await held;
            return HttpResponse.json(buildHubClaimStatus({ candidates: [], unclaimedCount: 0 }));
        }));
        const { queryClient } = renderWithProviders(<OverviewPrompts ctx={{ page: page() }} />);
        // Onboarding and devices have settled; only the held claim GET is in flight.
        await waitFor(() => { expect(claimRequested).toBe(true); });
        await waitFor(() => { expect(queryClient.isFetching()).toBe(1); });
        expect(screen.queryByTestId(COMPANION)).toBeNull();
        expect(screen.queryByTestId(CLAIM)).toBeNull();
        release();
        expect(await screen.findByTestId(COMPANION)).toBeInTheDocument();
        expect(screen.queryByTestId(CLAIM)).toBeNull();
    });

    it('with no claim provider for the hub, the Companion prompt shows as before', async () => {
        clearHubClaimProviders();
        serve();
        renderWithProviders(<OverviewPrompts ctx={{ page: page() }} />);
        expect(await screen.findByTestId(COMPANION)).toBeInTheDocument();
        expect(screen.queryByTestId(CLAIM)).toBeNull();
    });
});
