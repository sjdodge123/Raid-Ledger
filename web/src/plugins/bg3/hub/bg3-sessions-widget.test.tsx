/** ROK-1958 V-6 + the History half of V-7 — the BG3 "Session history" card, its rows and the Show all action. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { bg3CampaignsHandler, bg3SessionsHandler, bg3SnapshotHandler } from '../../../test/mocks/bg3-handlers';
import {
    BG3_CAMPAIGN_ID, BG3_HUB_ID, buildBg3CampaignsResponse, buildBg3Session, buildBg3SessionsResponse, buildBg3Snapshot,
} from '../../../test/factories/bg3';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { bg3Keys } from '../hooks/bg3-keys';
import { Bg3SeeAllAction } from './bg3-see-all-action';
import { Bg3SessionRow } from './bg3-session-row';
import Bg3SessionsWidget from './bg3-sessions-widget';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 33, username: 'thistle', displayName: 'Thistle', role: 'member' } }),
}));

function ctx(): HubWidgetCtx {
    const page = { guild: { id: BG3_HUB_ID }, viewer: { role: 'member', canEdit: false, canManageEditors: false } } as GuildPage;
    // The widget reads only `page.guild.id` (register.test idiom).
    return { page, gameSlug: 'baldurs-gate-3' } as HubWidgetCtx;
}

const day = (d: number): Partial<ReturnType<typeof buildBg3Session>> => ({
    startedAt: `2026-10-${String(d).padStart(2, '0')}T19:00:00.000Z`, endedAt: `2026-10-${String(d).padStart(2, '0')}T21:00:00.000Z`,
    lastSaveId: 100 + d, saveCount: d,
});

function must<T>(value: T | null | undefined, label: string): T {
    if (value === null || value === undefined) throw new Error(`missing: ${label}`);
    return value;
}

const rows = (): HTMLElement[] => screen.getAllByTestId('bg3-session-row');
const meta = (row: HTMLElement | undefined): string => within(must(row, 'row')).getByTestId('bg3-session-meta').textContent ?? '';

async function renderSessions(sessions = buildBg3SessionsResponse(), spy?: (url: URL) => void): Promise<void> {
    server.use(
        bg3CampaignsHandler(buildBg3CampaignsResponse()), bg3SnapshotHandler(buildBg3Snapshot()),
        bg3SessionsHandler({ '': sessions }, spy),
    );
    renderWithProviders(<Bg3SessionsWidget {...ctx()} />);
    await screen.findByTestId('bg3-sessions');
}

describe('Bg3SessionsWidget (V-6)', () => {
    it('asks for the active campaign\'s first five sessions', async () => {
        const spy = vi.fn();
        await renderSessions(undefined, spy);
        const url: URL | undefined = spy.mock.calls[0]?.[0];
        expect(url?.pathname).toBe(`/plugins/bg3/hubs/${BG3_HUB_ID}/campaigns/${BG3_CAMPAIGN_ID}/sessions`);
        expect(url?.searchParams.get('limit')).toBe('5');
    });

    it('lists newest first with the latest marker on the top row, at most five rows', async () => {
        const sessions = [3, 9, 5, 12, 1, 7].map((d) => buildBg3Session(day(d)));
        await renderSessions({ sessions, nextCursor: 'c2' });
        expect(rows()).toHaveLength(5);
        expect(rows().map((r) => meta(r).replace(/^.* · /, ''))).toEqual(['12 saves', '9 saves', '7 saves', '5 saves', '3 saves']);
        expect(rows().map((r) => r.dataset.latest ?? 'no')).toEqual(['true', 'no', 'no', 'no', 'no']);
    });

    it('a one-save session reads "1 save" with no range; the level change shows only when it differs', async () => {
        await renderSessions();
        const [first, second] = rows();
        expect(meta(second)).toBe('1 save');
        expect(first).toHaveTextContent('Level 7 → 8');
        expect(second).not.toHaveTextContent(/Level/);
    });

    it('caps area chips at three plus "+N", and draws none when areas are hidden', async () => {
        const areas = ['WLD_Main_A', 'CRE_Main_A', 'SCL_Main_A', 'BGO_Main_A', 'SYS_Menuscreen_Camp_A'];
        await renderSessions({ sessions: [buildBg3Session({ areas }), buildBg3Session({ ...day(1), areas: null })], nextCursor: null });
        const [first, second] = rows();
        const chips = within(must(first, 'first row')).getByTestId('bg3-session-areas').children;
        expect([...chips].map((c) => c.textContent)).toEqual(['Wilderness', 'Rosymorn Monastery', 'Shadow-Cursed Lands', '+2']);
        expect(within(must(second, 'second row')).queryByTestId('bg3-session-areas')).toBeNull();
    });

    it('renders nothing (and asks for no sessions) on an empty snapshot', async () => {
        const spy = vi.fn();
        server.use(
            bg3SnapshotHandler({ empty: true, campaignId: BG3_CAMPAIGN_ID }),
            bg3SessionsHandler({ '': buildBg3SessionsResponse() }, spy),
        );
        const { container, queryClient } = renderWithProviders(<Bg3SessionsWidget {...ctx()} />);
        await waitFor(() => expect(queryClient.getQueryState(bg3Keys.snapshot(BG3_HUB_ID))?.status).toBe('success'));
        expect(container).toBeEmptyDOMElement();
        expect(spy).not.toHaveBeenCalled();
    });

    it('renders nothing with no active campaign', async () => {
        server.use(bg3SnapshotHandler('no-campaign'));
        const { container, queryClient } = renderWithProviders(<Bg3SessionsWidget {...ctx()} />);
        await waitFor(() => expect(queryClient.getQueryState(bg3Keys.snapshot(BG3_HUB_ID))?.status).toBe('success'));
        expect(container).toBeEmptyDOMElement();
    });
});

describe('Bg3SessionRow', () => {
    it('reads "Tue 27 Oct" + "19:40–23:05 · 3 h 25 m · 14 saves" in the given zone', () => {
        render(<ol><Bg3SessionRow session={buildBg3Session()} latest timeZone="UTC" /></ol>);
        expect(screen.getByText('Tue 27 Oct')).toBeInTheDocument();
        expect(screen.getByTestId('bg3-session-meta')).toHaveTextContent(/^19:40–23:05 · 3 h 25 m · 14 saves$/);
    });
});

describe('Bg3SeeAllAction', () => {
    it('"Show all" links to the Campaign tab on the same hub page', () => {
        renderWithProviders(<Bg3SeeAllAction />, { initialEntries: ['/hubs/7?view=overview'] });
        expect(screen.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/hubs/7?view=overview#campaign');
    });
});
