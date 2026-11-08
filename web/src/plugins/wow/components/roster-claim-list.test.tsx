/**
 * ROK-2128 — Add character → "Guild roster" pick list: rows per guild with no
 * rank (FLAG 2), search with an empty state, one-click Claim carrying the
 * defaulted ruleset (FLAG 4), and a lost race (409) removing the row.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { CharacterDto, RosterClaimListResponseDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { invalidateAllHubMemberships } from '../../../components/hub/community/invalidate-hub-membership';
import { withoutMember } from '../lib/roster-claim';
import { RosterClaimList } from './roster-claim-list';

vi.mock('../../../components/hub/community/invalidate-hub-membership', () => ({
    invalidateAllHubMemberships: vi.fn(() => Promise.resolve()),
}));

const API_BASE = 'http://localhost:3000';
const GAME_ID = 7;

const LIST: RosterClaimListResponseDto = {
    truncated: false,
    guilds: [
        { guildId: 1, guildName: 'Ledger Test Guild', region: 'us', candidates: [
            { memberId: 11, name: 'Ashen Vale', class: 'Mage', level: 60, source: 'addon_import' },
            { memberId: 12, name: 'Brine Hollow', class: 'Priest', level: 42, source: 'addon_import' },
        ] },
        { guildId: 2, guildName: 'Night Market', region: 'us', candidates: [
            { memberId: 21, name: 'Fernwhistle Thorne', class: 'Druid', level: 18, source: 'blizzard' },
        ] },
    ],
};

function serveList(list: RosterClaimListResponseDto = LIST): void {
    server.use(http.get(`${API_BASE}/plugins/wow/roster-claim/candidates`, () => HttpResponse.json(list)));
}

/**
 * The server side of a lost race: the claim 409s, and from then on the
 * candidates refetch the 409 triggers no longer lists the row (a static LIST
 * would hand the row back and race the optimistic drop).
 */
function serveLostRace(memberId: number): void {
    let claimedElsewhere = false;
    server.use(
        http.get(`${API_BASE}/plugins/wow/roster-claim/candidates`, () => HttpResponse.json(
            claimedElsewhere ? { ...LIST, guilds: withoutMember(LIST.guilds, memberId) } : LIST)),
        http.post(`${API_BASE}/plugins/wow/roster-claim/members/:memberId/claim`, () => {
            claimedElsewhere = true;
            return HttpResponse.json({ message: 'Someone claimed this first' }, { status: 409 });
        }),
    );
}

function renderList(opts: { existing?: CharacterDto[]; onClaimed?: () => void; onSwitchTab?: (t: 'manual' | 'import') => void } = {}) {
    return renderWithProviders(
        <RosterClaimList gameId={GAME_ID} existingCharacters={opts.existing ?? []} armoryAvailable
            onClaimed={opts.onClaimed ?? (() => {})} onSwitchTab={opts.onSwitchTab ?? (() => {})} />,
    );
}

describe('RosterClaimList (ROK-2128)', () => {
    it('lists each guild with its rows: name and "Lv N · Class"', async () => {
        serveList();
        renderList();
        expect(await screen.findByText('Ashen Vale')).toBeInTheDocument();
        expect(screen.getByText('Lv 60 · Mage')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /ledger test guild/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /night market/i })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /^claim /i })).toHaveLength(3);
    });

    it('filters by name and shows the empty state for no hits', async () => {
        serveList();
        renderList();
        await screen.findByText('Ashen Vale');
        const search = screen.getByRole('searchbox', { name: /search guild roster/i });
        await userEvent.type(search, 'fern');
        await waitFor(() => expect(screen.queryByText('Ashen Vale')).not.toBeInTheDocument());
        expect(screen.getByText('Fernwhistle Thorne')).toBeInTheDocument();
        await userEvent.clear(search);
        await userEvent.type(search, 'zzz');
        expect(await screen.findByText('No unclaimed character matches “zzz”.')).toBeInTheDocument();
    });

    it("claims in one click with the ruleset of the user's other Forever character", async () => {
        serveList();
        let body: unknown = null;
        let claimedId = '';
        server.use(http.post(`${API_BASE}/plugins/wow/roster-claim/members/:memberId/claim`, async ({ request, params }) => {
            body = await request.json();
            claimedId = String(params.memberId);
            return HttpResponse.json({ id: 'c1', name: 'Ashen Vale' }, { status: 201 });
        }));
        const onClaimed = vi.fn();
        const existing = [{ ruleset: 'pvp', isMain: true } as CharacterDto];
        renderList({ existing, onClaimed });
        await userEvent.click(await screen.findByRole('button', { name: 'Claim Ashen Vale' }));
        await waitFor(() => expect(onClaimed).toHaveBeenCalledTimes(1));
        expect(claimedId).toBe('11');
        expect(body).toEqual({ ruleset: 'pvp', isMain: false });
        // Codex P2: a claim can make the player a guild member — hub caches refetch.
        expect(invalidateAllHubMemberships).toHaveBeenCalled();
    });

    it('removes the row when someone claimed it first (409)', async () => {
        serveLostRace(12);
        const onClaimed = vi.fn();
        renderList({ onClaimed });
        await userEvent.click(await screen.findByRole('button', { name: 'Claim Brine Hollow' }));
        await waitFor(() => expect(screen.queryByText('Brine Hollow')).not.toBeInTheDocument());
        expect(screen.getByText('Ashen Vale')).toBeInTheDocument();
        expect(onClaimed).not.toHaveBeenCalled();
    });

    it('shows the truncation hint and switches to Manual from the "Not listed?" link', async () => {
        serveList({ ...LIST, truncated: true });
        const onSwitchTab = vi.fn();
        renderList({ onSwitchTab });
        expect(await screen.findByText('Showing the first 1000 — search to narrow.')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /add it manually/i }));
        expect(onSwitchTab).toHaveBeenCalledWith('manual');
    });
});

describe('RosterClaimList — Armory spec + item level (ROK-2133)', () => {
    it('shows spec and item level on a row whose Armory snapshot has them, and only there (ROK-2133)', async () => {
        const [first, second] = LIST.guilds;
        if (!first || !second) throw new Error('LIST fixture needs two guilds');
        const synced = first.candidates.map((c) => (c.memberId === 11 ? { ...c, spec: 'Frost', itemLevel: 112 } : c));
        serveList({ ...LIST, guilds: [{ ...first, candidates: synced }, second] });
        renderList();
        await screen.findByText('Ashen Vale');
        expect(screen.getByText('Lv 60 · Mage · Frost · 112 iLvl')).toBeInTheDocument();
        expect(screen.getByText('Lv 42 · Priest'), 'a row without Armory data keeps the bare meta line').toBeInTheDocument();
        expect(screen.getAllByText(/iLvl/), 'only the synced row carries an item level').toHaveLength(1);
    });
});

describe('RosterClaimList — server-side search (ROK-2128 Codex P2)', () => {
    it('sends the search to the server so a row past the 1000 cap is findable (Codex P2)', async () => {
        const seen: (string | null)[] = [];
        const PAST_CAP = { truncated: false, guilds: [{ guildId: 9, guildName: 'Zz Big Guild', region: 'us', candidates: [
            { memberId: 99, name: 'Big 1000', class: null, level: null, source: 'addon_import' as const },
        ] }] };
        server.use(http.get(`${API_BASE}/plugins/wow/roster-claim/candidates`, ({ request }) => {
            const q = new URL(request.url).searchParams.get('q');
            seen.push(q);
            return HttpResponse.json(q ? PAST_CAP : { ...LIST, truncated: true });
        }));
        renderList();
        await screen.findByText('Ashen Vale');
        await userEvent.type(screen.getByRole('searchbox', { name: /search guild roster/i }), 'big 1000');
        expect(await screen.findByText('Big 1000')).toBeInTheDocument();
        expect(seen).toContain('big 1000');
    });
});
