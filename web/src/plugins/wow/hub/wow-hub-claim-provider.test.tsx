/**
 * ROK-2153 S5 — the WoW (blizzard) web claim provider: registered for Forever
 * guild hubs (so the ownership guard pairs it with the manifest) with
 * `overviewPrompt: false`, so the hub Overview treats a WoW hub as having no
 * claim provider: no `GET guilds/:id/claim`, no claim cell, and the Companion
 * prompt is not held back — for a member and for a staff non-member alike.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildHubClaimStatus } from '../../../test/mocks/hub-claim-handlers';
import { usePluginStore } from '../../../stores/plugin-store';
import { OverviewPrompts } from '../../../components/hub/hub-overview';
import { gatedHubClaimProvider, getHubClaimProviderRegistrations } from '../../../components/hub/claim/hub-claim-providers';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { wowHubClaimProvider } from './wow-hub-claim-provider';
// The real registration, exactly as the app loads it.
import '../register';

vi.mock('../../../lib/companion-install', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/companion-install')>()),
    companionDownloadAvailable: () => true,
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const API = 'http://localhost:3000';
const ACTIVE = new Set(['core', 'blizzard']);
const CLAIM = 'hub-claim-prompt';
const COMPANION = 'companion-install-prompt';

type Viewer = GuildPage['viewer'];
const MEMBER: Viewer = { role: 'member', canEdit: false, canManageEditors: false };
const STAFF_NON_MEMBER: Viewer = { role: 'visitor', canEdit: false, canManageEditors: false, isStaff: true };

function page(gameSlug: string = WOW_FOREVER_GAME_SLUG, kind: GuildPage['guild']['kind'] = 'wow_guild', viewer: Viewer = MEMBER, id = 7): GuildPage {
    return {
        guild: { id, gameId: 4, kind, name: 'Iron Remnant', region: 'us', realmSlug: null, realmName: 'Thunderfury', faction: 'Horde', memberCount: 142, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer,
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

/** Guild ids of every `GET guilds/:id/claim` the Overview sent. */
let claimRequests: string[] = [];

beforeEach(() => {
    claimRequests = [];
    usePluginStore.setState({ activeSlugs: ACTIVE, initialized: true });
    server.use(
        http.get(`${API}/guilds/:id/claim`, ({ params }) => {
            claimRequests.push(String(params.id));
            return HttpResponse.json(buildHubClaimStatus({ provider: 'blizzard', claimOptions: 'wow_ruleset', viewerIsMember: true, viewerHasClaim: true }));
        }),
        http.get(`${API}/guilds/onboarding`, () => HttpResponse.json({ dismissed: [] })),
        http.get(`${API}/companion/v1/devices`, () => HttpResponse.json({ data: [] })),
    );
});
afterEach(() => { server.resetHandlers(); });

describe('WoW hub claim provider — registration (ROK-2153 S5)', () => {
    it('is registered by the blizzard plugin for Forever guild hubs only, with no options step and no Overview prompt', () => {
        const mine = getHubClaimProviderRegistrations().filter((r) => r.pluginSlug === 'blizzard');
        expect(mine.map((r) => r.provider), 'register.ts registers exactly the WoW provider under blizzard').toEqual([wowHubClaimProvider]);
        expect(wowHubClaimProvider.games).toEqual([WOW_FOREVER_GAME_SLUG]);
        expect(wowHubClaimProvider.kinds).toEqual(['wow_guild']);
        expect(wowHubClaimProvider.OptionsStep, 'no ruleset UI on the core prompt').toBeUndefined();
        expect(wowHubClaimProvider.overviewPrompt, 'its claim surfaces live elsewhere').toBe(false);
    });

    it('never passes the Overview gate, even on a Forever guild hub with blizzard active', () => {
        expect(gatedHubClaimProvider(page(), ACTIVE)).toBeUndefined();
        expect(gatedHubClaimProvider(page(), new Set(['core']))).toBeUndefined();
    });
});

describe('a WoW hub Overview has no claim cell and sends no claim status GET (ROK-2153 S5)', () => {
    it('(a) a member: the Companion prompt shows, with zero claim requests and no claim cell', async () => {
        renderWithProviders(<OverviewPrompts ctx={{ page: page() }} />);
        await waitFor(() => { expect(screen.queryByTestId(COMPANION), 'the Companion prompt (settle point)').not.toBeNull(); });
        expect(claimRequests, 'no GET guilds/:id/claim from a WoW Overview').toEqual([]);
        expect(screen.queryByTestId(CLAIM)).toBeNull();
    });

    it('(b) a staff non-member: zero claim requests and no claim cell', async () => {
        // A non-member never gets the Companion prompt, so a member's Overview on a
        // second Forever hub (id 8) rendered alongside gives the settle point.
        renderWithProviders(
            <>
                <OverviewPrompts ctx={{ page: page(WOW_FOREVER_GAME_SLUG, 'wow_guild', STAFF_NON_MEMBER) }} />
                <OverviewPrompts ctx={{ page: page(WOW_FOREVER_GAME_SLUG, 'wow_guild', MEMBER, 8) }} />
            </>,
        );
        await waitFor(() => { expect(screen.queryAllByTestId(COMPANION), 'only the member sees the Companion prompt (settle point)').toHaveLength(1); });
        expect(claimRequests, 'no GET guilds/:id/claim for either viewer').toEqual([]);
        expect(screen.queryByTestId(CLAIM)).toBeNull();
    });
});
