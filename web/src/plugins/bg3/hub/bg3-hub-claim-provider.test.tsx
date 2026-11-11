/**
 * ROK-2153 S6-BG3 — a BG3 community hub shows the core claim prompt for the
 * active campaign's unclaimed party slots: gated to BG3 `game_community` hubs
 * of an active plugin, BG3 copy, a claim through the core route that then
 * refreshes the hub's BG3 queries (Party widget), a dismissal held per
 * campaign (`scopedDismissal`), and no prompt with nothing left to claim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { BG3_GAME_SLUG, type GuildPage, type HubClaimStatus, type HubOnboardingDismissalDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import { buildHubClaimCandidate, buildHubClaimResult, buildHubClaimStatus, hubClaimPostHandler, type HubClaimCall } from '../../../test/mocks/hub-claim-handlers';
import { usePluginStore } from '../../../stores/plugin-store';
import { HubClaimPromptCell } from '../../../components/hub/claim/hub-claim-prompt-cell';
import { gatedHubClaimProvider } from '../../../components/hub/claim/hub-claim-providers';
import type { HubClaimShowing } from '../../../components/hub/claim/hub-claim-prompt';
import { bg3Keys } from '../hooks/bg3-keys';
import { BG3_HUB_CLAIM_COPY, bg3HubClaimProvider } from './bg3-hub-claim-provider';
// The real registration, exactly as the app loads it.
import '../register';

vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000';
const ONBOARDING = `${API}/guilds/onboarding`;
const HUB = 4;
const OTHER_HUB = 5;
const AT = '2026-11-01T00:00:00.000Z';
const ELF = buildHubClaimCandidate({ id: '12:Generic:Elf_WoodElf:1', name: 'Wood Elf Barbarian', subtitle: 'Level 5 · Barbarian · Custom character' });
const SHART = buildHubClaimCandidate({ id: '12:Origin:Shadowheart:0', name: 'Half-Elf Cleric', subtitle: 'Level 5 · Cleric · Origin: Shadowheart' });

function page(kind: GuildPage['guild']['kind'] = 'game_community', gameSlug: string = BG3_GAME_SLUG): GuildPage {
    return {
        guild: { id: HUB, gameId: 3, kind, name: 'Party', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 2, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function bg3Status(over: Partial<HubClaimStatus> = {}): HubClaimStatus {
    return buildHubClaimStatus({ provider: 'bg3', candidates: [ELF, SHART], dismissScope: 'campaign-2', ...over });
}

const hits = { claim: 0 };
const calls: HubClaimCall[] = [];
const dismissals: string[] = [];

function serve(status: HubClaimStatus, dismissed: HubOnboardingDismissalDto[] = []): void {
    server.use(
        http.get(`${API}/guilds/:id/claim`, () => { hits.claim += 1; return HttpResponse.json(status); }),
        http.get(ONBOARDING, () => HttpResponse.json({ dismissed })),
        http.post(`${ONBOARDING}/:key/dismiss`, ({ request, params }) => {
            dismissals.push(`${String(params['key'])}?${new URL(request.url).searchParams.toString()}`);
            return HttpResponse.json({ dismissed });
        }),
        hubClaimPostHandler(buildHubClaimResult({ claimed: ELF }), calls),
    );
}

function row(scope: string): HubOnboardingDismissalDto {
    return { key: 'claim-character', guildId: HUB, scope, dismissedAt: AT };
}

beforeEach(() => {
    hits.claim = 0;
    calls.length = 0;
    dismissals.length = 0;
    usePluginStore.setState({ activeSlugs: new Set(['core', 'bg3']), initialized: true });
});
afterEach(() => { server.resetHandlers(); });

describe('BG3 hub claim provider — registration gate', () => {
    it('serves BG3 community hubs while the plugin is active, nothing else', () => {
        expect(gatedHubClaimProvider(page(), new Set(['core', 'bg3']))?.provider, 'the BG3 registration serves a BG3 community hub').toBe(bg3HubClaimProvider);
        expect(gatedHubClaimProvider(page(), new Set(['core'])), 'inactive plugin').toBeUndefined();
        expect(gatedHubClaimProvider(page('game_server'), new Set(['core', 'bg3'])), 'BG3 server hub').toBeUndefined();
        expect(gatedHubClaimProvider(page('game_community', 'valheim'), new Set(['core', 'bg3'])), 'another game').toBeUndefined();
        expect(bg3HubClaimProvider.scopedDismissal).toBe(true);
    });
});

describe('BG3 hub — core claim prompt (ROK-2153 S6)', () => {
    it('lists the party slots, claims through the core route, then refreshes this hub\'s BG3 queries only', async () => {
        serve(bg3Status());
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(bg3Keys.snapshot(HUB), {});
        queryClient.setQueryData(bg3Keys.campaigns(HUB), []);
        queryClient.setQueryData(bg3Keys.snapshot(OTHER_HUB), {});
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />, { queryClient });

        const prompt = await screen.findByTestId('hub-claim-prompt');
        expect(within(prompt).getByRole('heading', { name: BG3_HUB_CLAIM_COPY.heading })).toBeInTheDocument();
        expect(within(prompt).getByTestId('hub-claim-prompt-body')).toHaveTextContent(BG3_HUB_CLAIM_COPY.body);
        await userEvent.click(within(prompt).getByRole('button', { name: 'Pick my character' }));
        const list = await screen.findByTestId('hub-claim-candidates');
        expect(within(list).getByText('Level 5 · Cleric · Origin: Shadowheart')).toBeInTheDocument();
        await userEvent.click(within(list).getByRole('button', { name: 'Claim Wood Elf Barbarian' }));

        await waitFor(() => { expect(calls).toEqual([{ hubId: HUB, candidateId: ELF.id, body: {} }]); });
        await waitFor(() => {
            expect(queryClient.getQueryState(bg3Keys.snapshot(HUB))?.isInvalidated, 'the Party widget snapshot refreshes after a hub claim').toBe(true);
        });
        expect(queryClient.getQueryState(bg3Keys.campaigns(HUB))?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(bg3Keys.snapshot(OTHER_HUB))?.isInvalidated, 'another hub\'s BG3 queries stay cached').toBe(false);
    });

    it('a dismissal for campaign 1 does not hide campaign 2\'s prompt, and the × dismisses campaign 2 only', async () => {
        serve(bg3Status({ dismissScope: 'campaign-2' }), [row('campaign-1')]);
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} />);
        expect(await screen.findByTestId('hub-claim-prompt')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: "Dismiss: don't show this again" }));
        await waitFor(() => { expect(screen.queryByTestId('hub-claim-prompt')).toBeNull(); });
        expect(dismissals, 'the dismissal is stored for the active campaign only').toEqual([`claim-character?guildId=${HUB}&scope=campaign-2`]);
    });

    it('shows nothing when every party slot is claimed (unclaimedCount 0)', async () => {
        serve(bg3Status({ candidates: [], unclaimedCount: 0 }));
        const showing = vi.fn<(state: HubClaimShowing) => void>();
        renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} onShowingChange={showing} />);
        await waitFor(() => { expect(showing).toHaveBeenLastCalledWith('hidden'); });
        expect(hits.claim).toBeGreaterThan(0);
        expect(showing).not.toHaveBeenCalledWith('showing');
        expect(screen.queryByTestId('hub-claim-prompt')).toBeNull();
    });
});
