/**
 * ROK-2153 S4 — the Valheim hub shows the core claim prompt (not the retired
 * claim-banner widget) with Valheim's approved copy, the suggested match as a
 * one-click claim that refreshes the Valheim caches, and nothing at all while
 * the Valheim plugin is inactive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import { buildHubClaimCandidate, buildHubClaimResult, buildHubClaimStatus, hubClaimPostHandler, type HubClaimCall } from '../../../test/mocks/hub-claim-handlers';
import { usePluginStore } from '../../../stores/plugin-store';
import { HubClaimPromptCell } from '../../../components/hub/claim/hub-claim-prompt-cell';
import { valheimArmoryKeys } from '../lib/valheim-armory-api';
import { CLAIM_BANNER_COPY } from './valheim-claim-banner.helpers';
import { invalidateAfterHubClaim } from './valheim-hub-claim-provider';
// The real registration, exactly as the app loads it.
import '../register';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000';
const ASK = buildHubClaimCandidate({ id: '12', name: 'Ask', subtitle: 'World: Midgard', detailPath: '/valheim/characters/12', match: 'strong', matchReason: 'same_name' });

function page(): GuildPage {
    return {
        guild: { id: 4, gameId: 3, kind: 'game_server', name: 'Valheim', region: 'server', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug: 'valheim' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false, notificationsMuted: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        server: { pelicanServerId: 7, gameSlug: 'valheim', gameIconUrl: null, state: 'running', viewerJoined: true },
    };
}

const hits = { claim: 0 };
const calls: HubClaimCall[] = [];

beforeEach(() => {
    hits.claim = 0;
    calls.length = 0;
    server.use(
        http.get(`${API}/guilds/:id/claim`, () => {
            hits.claim += 1;
            return HttpResponse.json(buildHubClaimStatus({ suggested: ASK, candidates: [ASK] }));
        }),
        http.get(`${API}/guilds/onboarding`, () => HttpResponse.json({ dismissed: [] })),
        hubClaimPostHandler(buildHubClaimResult({ claimed: { ...ASK, match: null, matchReason: null } }), calls),
    );
});
afterEach(() => { server.resetHandlers(); });

describe('Valheim hub — core claim prompt (ROK-2153 S4)', () => {
    it("shows Valheim's copy and claims the suggested match in one click, refreshing the Valheim caches", async () => {
        usePluginStore.setState({ activeSlugs: new Set(['core', 'valheim']), initialized: true });
        const queryClient = createTestQueryClient();
        const statusKey = valheimArmoryKeys.claimStatus(7);
        queryClient.setQueryData(statusKey, { viewerHasClaim: false, unclaimedCount: 1 });
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />, { queryClient });

        const prompt = await screen.findByTestId('hub-claim-prompt');
        expect(within(prompt).getByRole('heading', { name: CLAIM_BANNER_COPY.linkHeading(CLAIM_BANNER_COPY.fallbackServer) })).toBeInTheDocument();
        expect(within(prompt).getByTestId('hub-claim-prompt-body')).toHaveTextContent(CLAIM_BANNER_COPY.linkBody);
        expect(within(prompt).getByRole('button', { name: CLAIM_BANNER_COPY.pick })).toBeInTheDocument();

        await userEvent.click(within(await screen.findByTestId('hub-claim-suggested')).getByRole('button', { name: 'Claim Ask' }));
        await waitFor(() => { expect(calls).toEqual([{ hubId: 4, candidateId: '12', body: {} }]); });
        await waitFor(() => {
            expect(queryClient.getQueryState(statusKey)?.isInvalidated, 'the armory claim-status refreshes after a hub claim').toBe(true);
        });
    });

    it('renders nothing and fetches no claim status while the Valheim plugin is inactive', async () => {
        usePluginStore.setState({ activeSlugs: new Set(['core']), initialized: true });
        const { container } = renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />);
        // Flush any lazy chunk / effect before asserting the absence.
        await new Promise<void>((resolve) => { queueMicrotask(resolve); });
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByTestId('hub-claim-prompt')).toBeNull();
        expect(hits.claim).toBe(0);
    });
});

describe('invalidateAfterHubClaim', () => {
    it('refreshes nothing for a candidate id that is not an armory profile id', async () => {
        const queryClient = createTestQueryClient();
        const spy = vi.spyOn(queryClient, 'invalidateQueries');
        await invalidateAfterHubClaim(buildHubClaimResult({ claimed: buildHubClaimCandidate({ id: 'not-a-number' }) }), queryClient);
        expect(spy).not.toHaveBeenCalled();
    });
});
