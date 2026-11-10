/**
 * ROK-2153 S5 — the WoW (blizzard) web claim provider: registered for Forever
 * guild hubs while the plugin is active, and the core Overview claim prompt
 * never renders on a WoW hub — not for a member (who always has a claim), not
 * for a staff non-member, and not even for a status that would otherwise show
 * it, because a ruleset claim has no options step on the web (fail closed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildPage, HubClaimStatus } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildHubClaimCandidate, buildHubClaimStatus } from '../../../test/mocks/hub-claim-handlers';
import { usePluginStore } from '../../../stores/plugin-store';
import { HubClaimPromptCell } from '../../../components/hub/claim/hub-claim-prompt-cell';
import type { HubClaimShowing } from '../../../components/hub/claim/hub-claim-prompt';
import { gatedHubClaimProvider, getHubClaimProviderRegistrations } from '../../../components/hub/claim/hub-claim-providers';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { wowHubClaimProvider } from './wow-hub-claim-provider';
// The real registration, exactly as the app loads it.
import '../register';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000';
const ACTIVE = new Set(['core', 'blizzard']);
const ROWS = [buildHubClaimCandidate({ id: '31', name: 'Thrall' }), buildHubClaimCandidate({ id: '32', name: 'Jaina' })];

function page(gameSlug: string = WOW_FOREVER_GAME_SLUG, kind: GuildPage['guild']['kind'] = 'wow_guild'): GuildPage {
    return {
        guild: { id: 7, gameId: 4, kind, name: 'Iron Remnant', region: 'us', realmSlug: null, realmName: 'Thunderfury', faction: 'Horde', memberCount: 142, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role: 'leader', canEdit: false, canManageEditors: false, isStaff: true },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function wowStatus(over: Partial<HubClaimStatus>): HubClaimStatus {
    return buildHubClaimStatus({ provider: 'blizzard', claimOptions: 'wow_ruleset', candidates: ROWS, ...over });
}

const hits = { claim: 0 };
let status: HubClaimStatus = wowStatus({});

beforeEach(() => {
    hits.claim = 0;
    server.use(
        http.get(`${API}/guilds/:id/claim`, () => {
            hits.claim += 1;
            return HttpResponse.json(status);
        }),
        http.get(`${API}/guilds/onboarding`, () => HttpResponse.json({ dismissed: [] })),
    );
});
afterEach(() => { server.resetHandlers(); });

describe('WoW hub claim provider — registration (ROK-2153 S5)', () => {
    it('is registered by the blizzard plugin for Forever guild hubs only, with no options step', () => {
        const mine = getHubClaimProviderRegistrations().filter((r) => r.pluginSlug === 'blizzard');
        expect(mine.map((r) => r.provider), 'register.ts registers exactly the WoW provider under blizzard').toEqual([wowHubClaimProvider]);
        expect(wowHubClaimProvider.games).toEqual([WOW_FOREVER_GAME_SLUG]);
        expect(wowHubClaimProvider.kinds).toEqual(['wow_guild']);
        expect(wowHubClaimProvider.OptionsStep, 'no ruleset UI on the core prompt').toBeUndefined();
    });

    it('serves a Forever guild hub while blizzard is active, and nothing once it is inactive or off-game', () => {
        expect(gatedHubClaimProvider(page(), ACTIVE)?.provider, 'active blizzard serves a Forever guild hub').toBe(wowHubClaimProvider);
        expect(gatedHubClaimProvider(page(), new Set(['core']))).toBeUndefined();
        expect(gatedHubClaimProvider(page('world-of-warcraft-classic'), ACTIVE)).toBeUndefined();
        expect(gatedHubClaimProvider(page(WOW_FOREVER_GAME_SLUG, 'game_community'), ACTIVE)).toBeUndefined();
    });
});

/** Render the core cell on a Forever hub and wait until it has decided (`hidden` after the status arrived). */
async function renderCell(next: HubClaimStatus): Promise<HubClaimShowing[]> {
    status = next;
    usePluginStore.setState({ activeSlugs: ACTIVE, initialized: true });
    const reports: HubClaimShowing[] = [];
    renderWithProviders(<HubClaimPromptCell ctx={{ page: page() }} onShowingChange={(s) => { reports.push(s); }} />);
    await waitFor(() => { expect(hits.claim, 'the core cell read the core claim status').toBeGreaterThan(0); });
    await waitFor(() => { expect(reports.at(-1), 'the cell settled').toBe('hidden'); });
    return reports;
}

describe('no core claim prompt on a WoW hub (ROK-2153 S5)', () => {
    it('(a) a member — who always has a claim — gets no core prompt', async () => {
        const reports = await renderCell(wowStatus({ viewerIsMember: true, viewerHasClaim: true }));
        expect(screen.queryByTestId('hub-claim-prompt')).toBeNull();
        expect(reports, 'the prompt never showed').not.toContain('showing');
    });

    it('(b) a staff non-member gets no core prompt (the forever-claim-banner is theirs)', async () => {
        const reports = await renderCell(wowStatus({ viewerIsMember: false, viewerHasClaim: false }));
        expect(screen.queryByTestId('hub-claim-prompt')).toBeNull();
        expect(reports, 'the prompt never showed').not.toContain('showing');
    });

    it('fails closed: a ruleset claim with no options step is never offered on the core prompt', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const reports = await renderCell(wowStatus({ viewerIsMember: true, viewerHasClaim: false }));
        expect(screen.queryByTestId('hub-claim-prompt'), 'no claim without the ruleset the server asks for').toBeNull();
        expect(reports).not.toContain('showing');
        error.mockRestore();
    });
});
