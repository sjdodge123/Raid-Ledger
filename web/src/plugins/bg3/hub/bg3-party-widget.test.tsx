/** ROK-1958 V-3 / V-4 — the BG3 Party card: tiles, claims, XP bar, coverage strip, empty states. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage } from '@raid-ledger/contract';
import type { User } from '../../../hooks/use-auth';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    BG3_CLAIMS_URL, BG3_SNAPSHOT_URL, bg3CampaignsHandler, bg3ClaimHandler, bg3SnapshotHandler, bg3UnclaimHandler,
} from '../../../test/mocks/bg3-handlers';
import {
    BG3_CAMPAIGN_ID, BG3_HUB_ID, buildBg3CampaignSummary, buildBg3CampaignsResponse, buildBg3Claim,
    buildBg3NoCampaignsResponse, buildBg3Party, buildBg3PartySlot, buildBg3Snapshot,
} from '../../../test/factories/bg3';
import { toast } from '../../../lib/toast';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import Bg3PartyWidget from './bg3-party-widget';

type AuthUser = Pick<User, 'id' | 'username' | 'displayName' | 'role'>;
const auth = vi.hoisted((): { user: AuthUser | null } => ({
    user: { id: 33, username: 'thistle', displayName: 'Thistle', role: 'member' },
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: auth.user }),
}));
vi.mock('../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function ctx(role: 'member' | 'visitor' = 'member'): HubWidgetCtx {
    const page = { guild: { id: BG3_HUB_ID }, viewer: { role, canEdit: false, canManageEditors: false } } as GuildPage;
    // The widget reads only `page.guild.id` and `page.viewer.role` (register.test idiom).
    return { page, gameSlug: 'baldurs-gate-3' } as HubWidgetCtx;
}

function must<T>(value: T | null | undefined, label: string): T {
    if (value === null || value === undefined) throw new Error(`missing: ${label}`);
    return value;
}

const slots = (): HTMLElement[] => screen.getAllByTestId('bg3-party-slot');
const slot = (key: string): HTMLElement => must(slots().find((s) => s.dataset.slotKey === key), key);
const claimButtons = (): HTMLElement[] => screen.queryAllByRole('button', { name: "That's me" });
const removeButtons = (): HTMLElement[] => screen.queryAllByRole('button', { name: /^Remove .*'s claim/ });

function serve(campaigns = buildBg3CampaignsResponse(), snapshot = buildBg3Snapshot()): void {
    server.use(bg3CampaignsHandler(campaigns), bg3SnapshotHandler(snapshot));
}

async function renderParty(role: 'member' | 'visitor' = 'member'): Promise<void> {
    renderWithProviders(<Bg3PartyWidget {...ctx(role)} />);
    await waitFor(() => expect(slots()).toHaveLength(4));
}

beforeEach(() => {
    auth.user = { id: 33, username: 'thistle', displayName: 'Thistle', role: 'member' };
    vi.mocked(toast.error).mockClear();
});

describe('Bg3PartyWidget — tiles (V-3)', () => {
    it('draws four member tiles, the subtitle and one "+1 summon" line', async () => {
        serve();
        await renderParty();
        expect(screen.getByText('Tactician run · 4 in party')).toBeInTheDocument();
        expect(screen.getByTestId('bg3-party-summons').textContent).toBe('+1 summon: Scratch');
        const first = slot('Generic:Elf_WoodElf:1');
        expect(within(first).getByText('Wood Elf')).toBeInTheDocument();
        expect(within(first).getByText('Level 8')).toBeInTheDocument();
        expect(within(first).getByText('Barbarian (Berserker)')).toBeInTheDocument();
        expect(within(first).getByText('Custom character')).toBeInTheDocument();
    });

    it('shows "That\'s me" only on unclaimed slots while the viewer holds no claim', async () => {
        serve();
        await renderParty();
        expect(claimButtons()).toHaveLength(3);
        expect(within(slot('Generic:Elf_WoodElf:1')).queryByRole('button', { name: "That's me" })).toBeNull();
        expect(within(slot('Generic:Elf_WoodElf:1')).getByText('Moonwhisper')).toBeInTheDocument();
    });

    it('claims optimistically: the tile shows "You" + "Not me" before the POST answers', async () => {
        const bodies: unknown[] = [];
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        serve();
        server.use(http.post(BG3_CLAIMS_URL, async ({ request, params }) => {
            bodies.push({ body: await request.json(), campaignId: params.campaignId });
            await gate;
            return new HttpResponse(null, { status: 204 });
        }));
        await renderParty();
        await userEvent.click(must(within(slot('Generic:Human:1')).queryByRole('button', { name: "That's me" }), 'claim'));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(within(slot('Generic:Human:1')).getByText('You')).toBeInTheDocument();
        expect(within(slot('Generic:Human:1')).getByRole('button', { name: 'Not me' })).toBeInTheDocument();
        expect(claimButtons()).toHaveLength(0);
        expect(bodies[0]).toEqual({ body: { slotKey: 'Generic:Human:1' }, campaignId: String(BG3_CAMPAIGN_ID) });
        release();
    });

    it('own slot shows "You" + "Not me", hides every "That\'s me", and "Not me" DELETEs it', async () => {
        auth.user = { id: 21, username: 'moon', displayName: 'Moonwhisper', role: 'member' };
        const spy = vi.fn();
        serve();
        server.use(bg3UnclaimHandler(204, spy));
        await renderParty();
        const mine = slot('Generic:Elf_WoodElf:1');
        expect(within(mine).getByText('You')).toBeInTheDocument();
        expect(claimButtons()).toHaveLength(0);
        expect(within(slot('Generic:Human:1')).getByText('Unclaimed')).toBeInTheDocument();
        await userEvent.click(within(mine).getByRole('button', { name: 'Not me' }));
        await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
        expect(spy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ slotKey: 'Generic:Elf_WoodElf:1' }));
    });

});

describe('Bg3PartyWidget — claim conflict (V-3)', () => {
    it('rolls back and toasts on a 409', async () => {
        serve();
        server.use(bg3ClaimHandler(409));
        await renderParty();
        await userEvent.click(must(within(slot('Generic:Human:1')).queryByRole('button', { name: "That's me" }), 'claim'));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Someone claimed this character first.'));
        await waitFor(() => expect(claimButtons()).toHaveLength(3));
        expect(within(slot('Generic:Human:1')).queryByText('You')).toBeNull();
    });

    it('says the viewer already has a claim on a 409 already_claimed (claim on a character out of the party)', async () => {
        serve();
        server.use(bg3ClaimHandler(409, undefined, 'already_claimed'));
        await renderParty();
        await userEvent.click(must(within(slot('Generic:Human:1')).queryByRole('button', { name: "That's me" }), 'claim'));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've already claimed a character in this campaign."));
        expect(toast.error).not.toHaveBeenCalledWith('Someone claimed this character first.');
        await waitFor(() => expect(within(slot('Generic:Human:1')).queryByText('You')).toBeNull());
    });
});

describe('Bg3PartyWidget — removing others\' claims (V-3)', () => {
    it('never shows the × to a plain member', async () => {
        serve(buildBg3CampaignsResponse({ campaigns: [buildBg3CampaignSummary({ hostUserId: 99 })] }));
        await renderParty();
        expect(removeButtons()).toHaveLength(0);
    });

    it.each([
        ['the campaign host', () => buildBg3CampaignsResponse({ campaigns: [buildBg3CampaignSummary({ hostUserId: 33 })] }), 'member'],
        ['a hub editor', () => buildBg3CampaignsResponse({ canEdit: true, campaigns: [buildBg3CampaignSummary({ hostUserId: 99 })] }), 'member'],
    ] as const)('shows the × to %s', async (_who, campaigns, role) => {
        serve(campaigns());
        await renderParty(role);
        expect(removeButtons().map((b) => b.getAttribute('aria-label'))).toEqual(["Remove Moonwhisper's claim on Wood Elf Barbarian"]);
    });

    it('staff non-member: the × but no "That\'s me" (claims need membership)', async () => {
        auth.user = { id: 50, username: 'op', displayName: 'Op', role: 'operator' };
        serve(buildBg3CampaignsResponse({ campaigns: [buildBg3CampaignSummary({ hostUserId: 99 })] }));
        await renderParty('visitor');
        expect(claimButtons()).toHaveLength(0);
        expect(removeButtons()).toHaveLength(1);
    });
});

describe('Bg3PartyWidget — XP bar (Q3) and coverage strip (Q4)', () => {
    it('fills the XP bar by the share of the way to the next level', async () => {
        serve();
        await renderParty();
        const xp = within(slot('Generic:Elf_WoodElf:1')).getByTestId('bg3-party-xp');
        // L8 floor 30,000 → L9 42,000; xpTotal 35,630 = 46.9 %.
        expect(within(xp).getByRole('meter').getAttribute('aria-valuenow')).toBe('47');
        expect(xp.textContent).toContain('6,370 XP to Level 9');
    });

    it('shows a full bar and "Max level" at level 12', async () => {
        const party = buildBg3Party().map((s, i) => (i === 0 ? { ...s, level: 12, xpTotal: 120_000 } : s));
        serve(undefined, buildBg3Snapshot({ party }));
        await renderParty();
        const xp = within(slot('Generic:Elf_WoodElf:1')).getByTestId('bg3-party-xp');
        expect(within(xp).getByRole('meter').getAttribute('aria-valuenow')).toBe('100');
        expect(xp.textContent).toContain('Max level');
    });

    it('lights every role for the factory party (Barbarian, Wizard, Ranger/Rogue, Paladin)', async () => {
        serve();
        await renderParty();
        const items = within(screen.getByTestId('bg3-party-coverage')).getAllByRole('listitem');
        expect(items.map((li) => `${li.dataset.role}:${li.dataset.covered}`))
            .toEqual(['healer:true', 'arcane:true', 'tank:true', 'face:true']);
    });

    it('marks the gaps of a Fighter + Wizard party (summons ignored)', async () => {
        const party = [
            buildBg3PartySlot({ classes: [{ main: 'Fighter', sub: null }], slotKey: 'Generic:Human:1' }),
            buildBg3PartySlot({ classes: [{ main: 'Wizard', sub: null }], slotKey: 'Generic:Human:2' }),
            buildBg3PartySlot({ classes: [{ main: 'Cleric', sub: null }], isSummon: true, slotKey: null }),
            buildBg3PartySlot({ classes: [{ main: 'Monk', sub: null }], slotKey: 'Generic:Human:3' }),
            buildBg3PartySlot({ classes: [{ main: 'Rogue', sub: null }], slotKey: 'Generic:Human:4', claim: buildBg3Claim() }),
        ];
        serve(undefined, buildBg3Snapshot({ party }));
        await renderParty();
        const items = within(screen.getByTestId('bg3-party-coverage')).getAllByRole('listitem');
        expect(items.filter((li) => li.dataset.covered === 'false').map((li) => li.textContent))
            .toEqual(['Healer missing', 'Face missing']);
    });
});

describe('Bg3PartyWidget — empty and error states (V-4)', () => {
    it('no campaign on the hub → "Start a campaign"', async () => {
        server.use(bg3CampaignsHandler(buildBg3NoCampaignsResponse()), bg3SnapshotHandler('no-campaign'));
        renderWithProviders(<Bg3PartyWidget {...ctx()} />);
        expect(await screen.findByText('No campaign on this hub yet.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start a campaign' })).toBeInTheDocument();
    });

    it('staff non-member sees the empty states without the start/add buttons (Q9)', async () => {
        auth.user = { id: 50, username: 'op', displayName: 'Op', role: 'operator' };
        server.use(bg3CampaignsHandler(buildBg3NoCampaignsResponse()), bg3SnapshotHandler('no-campaign'));
        renderWithProviders(<Bg3PartyWidget {...ctx('visitor')} />);
        expect(await screen.findByText('No campaign on this hub yet.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Start a campaign' })).not.toBeInTheDocument();
    });

    it('active campaign with no saves → "Add my saves"', async () => {
        serve(undefined, { empty: true, campaignId: BG3_CAMPAIGN_ID } as never);
        renderWithProviders(<Bg3PartyWidget {...ctx()} />);
        expect(await screen.findByText('No saves in Tactician run yet.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add my saves' })).toBeInTheDocument();
    });

    it('campaigns but none active: editors get "Pick the active campaign." + the Campaign tab link', async () => {
        server.use(bg3CampaignsHandler(buildBg3CampaignsResponse({ canEdit: true })), bg3SnapshotHandler('no-campaign'));
        renderWithProviders(<Bg3PartyWidget {...ctx()} />, { initialEntries: ['/hubs/7?x=1'] });
        expect(await screen.findByText('Pick the active campaign.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open Campaign' }).getAttribute('href')).toBe('/hubs/7?x=1#campaign');
    });

    it('campaigns but none active: members get "No active campaign." and no link', async () => {
        server.use(bg3CampaignsHandler(buildBg3CampaignsResponse()), bg3SnapshotHandler('no-campaign'));
        renderWithProviders(<Bg3PartyWidget {...ctx()} />);
        expect(await screen.findByText('No active campaign.')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Open Campaign' })).toBeNull();
    });

    it('a 500 → "Couldn\'t load the party." and "Try again" refetches', async () => {
        let calls = 0;
        server.use(bg3CampaignsHandler(buildBg3CampaignsResponse()), http.get(BG3_SNAPSHOT_URL, () => {
            calls += 1;
            return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }));
        renderWithProviders(<Bg3PartyWidget {...ctx()} />);
        expect(await screen.findByText("Couldn't load the party.", undefined, { timeout: 5000 })).toBeInTheDocument();
        const before = calls;
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(calls).toBeGreaterThan(before));
    });
});

describe('Bg3PartyWidget — empty-state dialogs (D-4 / D-5)', () => {
    it('"Start a campaign" opens the start dialog with its name field', async () => {
        server.use(bg3CampaignsHandler(buildBg3NoCampaignsResponse()), bg3SnapshotHandler('no-campaign'));
        const user = userEvent.setup();
        renderWithProviders(<Bg3PartyWidget {...ctx()} />);
        expect(screen.queryByLabelText(/Campaign name/)).not.toBeInTheDocument();
        await user.click(await screen.findByRole('button', { name: 'Start a campaign' }));
        expect(await screen.findByLabelText(/Campaign name/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start campaign' })).toBeInTheDocument();
    });

    it('"Add my saves" opens the add-saves sheet for the active campaign', async () => {
        serve(undefined, { empty: true, campaignId: BG3_CAMPAIGN_ID } as never);
        const user = userEvent.setup();
        renderWithProviders(<Bg3PartyWidget {...ctx()} />);
        expect(screen.queryByText('Add my saves to Tactician run')).not.toBeInTheDocument();
        await user.click(await screen.findByRole('button', { name: 'Add my saves' }));
        expect(await screen.findByText('Add my saves to Tactician run')).toBeInTheDocument();
    });
});
