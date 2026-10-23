/** ROK-1933 Part 1 — the claim banner on the Characters tab and the Overview card. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import {
    VALHEIM_CHARACTERS_URL,
    VALHEIM_CLAIM_STATUS_URL,
    valheimCharacterClaimed,
    valheimCharacterUnclaimed,
} from '../../../test/mocks/valheim-armory-handlers';
import { valheimArmoryKeys } from '../lib/valheim-armory-api';
import { ValheimCharactersTab } from './valheim-characters-tab';
import { ValheimClaimBanner } from './valheim-claim-banner';

const auth = vi.hoisted(() => ({ user: { id: 9, steamId: null as string | null } }));
const linkSteam = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
    useAuth: () => ({ user: auth.user }),
}));
vi.mock('../../../hooks/use-steam-link', () => ({
    useSteamLink: () => ({ linkSteam, isLinkPending: false }),
}));

let rows: ValheimCharacterSummary[] = [];
/** Search strings of every list request, to prove the filter went to the server. */
let listQueries: string[] = [];
const mine = (): ValheimCharacterSummary => ({
    ...valheimCharacterUnclaimed,
    claimedBy: { id: 9, username: 'me', avatar: null, discordId: '9' },
    claimSource: 'manual',
});
const heading = /playing on/i;

beforeEach(() => {
    auth.user = { id: 9, steamId: null };
    rows = [valheimCharacterClaimed, valheimCharacterUnclaimed];
    listQueries = [];
    server.use(
        http.get(VALHEIM_CHARACTERS_URL, ({ request }) => {
            const q = new URL(request.url).searchParams;
            listQueries.push(q.toString());
            const unclaimed = q.get('unclaimed') === '1';
            return HttpResponse.json({ data: unclaimed ? rows.filter((r) => r.claimedBy === null) : rows });
        }),
        // The server's facts, derived from the same rows the list serves.
        http.get(VALHEIM_CLAIM_STATUS_URL, () => HttpResponse.json({
            viewerHasClaim: rows.some((r) => r.claimedBy?.id === auth.user.id),
            unclaimedCount: rows.filter((r) => r.claimedBy === null).length,
        })),
    );
});
afterEach(() => localStorage.clear());

/** Claim status pre-seeded, so a missing banner means "dismissed", never "still loading". */
function overview(queryClient = createTestQueryClient()): void {
    queryClient.setQueryData(valheimArmoryKeys.claimStatus(7), { viewerHasClaim: false, unclaimedCount: 1 });
    renderWithProviders(
        <ValheimClaimBanner serverId={7} dismissible />,
        { initialEntries: ['/hubs/4'], queryClient },
    );
}

describe('claim banner — Characters tab', () => {
    it('shows Link Steam + Pick when the viewer has no claim and one is unclaimed', async () => {
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Link Steam' }));
        expect(linkSteam).toHaveBeenCalledWith('/#characters');
        expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    });

    it('stays hidden when every character is claimed', async () => {
        rows = [valheimCharacterClaimed];
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByText('member1')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    });

    it('drops Link Steam for a Steam-linked viewer (variant b)', async () => {
        auth.user = { id: 9, steamId: '76561198000000000' };
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByRole('heading', { name: /can't find your character/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Link Steam' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Pick my character' })).toBeInTheDocument();
    });

    it('hides after the viewer claims (characters query invalidated)', async () => {
        const queryClient = createTestQueryClient();
        renderWithProviders(<ValheimCharactersTab serverId={7} />, { queryClient });
        expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
        // Another character stays unclaimed, so only the viewer's claim can hide it.
        rows = [{ ...valheimCharacterUnclaimed, id: 99, name: 'Other' }, mine()];
        await queryClient.invalidateQueries({ queryKey: valheimArmoryKeys.all });
        await waitFor(() => expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument());
    });

    it('Pick my character filters the list to unclaimed rows', async () => {
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        await userEvent.click(await screen.findByRole('button', { name: 'Pick my character' }));
        expect(screen.getByRole('button', { name: 'Unclaimed only' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByText('member1')).not.toBeInTheDocument();
        expect(screen.getByText(valheimCharacterUnclaimed.name)).toBeInTheDocument();
        expect(listQueries.at(-1)).toContain('unclaimed=1');
    });

    it('shows on a server bigger than one list page when only the server knows a row is unclaimed (D1)', async () => {
        const full = Array.from({ length: 50 }, (_, i) => ({ ...valheimCharacterClaimed, id: 100 + i, name: `Viking ${i}` }));
        server.use(
            http.get(VALHEIM_CHARACTERS_URL, () => HttpResponse.json({ data: full })),
            http.get(VALHEIM_CLAIM_STATUS_URL, () => HttpResponse.json({ viewerHasClaim: false, unclaimedCount: 4 })),
        );
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load more characters' })).toBeInTheDocument();
    });

    it('ignores an Overview dismiss and stays shown', async () => {
        overview();
        await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
        renderWithProviders(<ValheimCharactersTab serverId={7} />);
        expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    });
});

describe('claim banner — Overview', () => {
    it('a dismiss hides it and is remembered across renders', async () => {
        overview();
        expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
        overview();
        expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    });
});
