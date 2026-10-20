/**
 * ROK-1832 — the per-group bell on the hub hero: shown only to real members
 * (D11), toggles optimistically through `/guilds/:id/notification-mute`, and
 * rolls back with a toast when the write fails.
 */
import type { JSX } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage, GuildViewerAccess } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { useGuildPage } from './api/use-guild';
import { toast } from '../../lib/toast';
import { HubNotifyBell } from './hub-notify-bell';

vi.mock('../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const API = 'http://localhost:3000/guilds/7';

function makePage(viewer: GuildViewerAccess): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: 'Horde', memberCount: 3, lastSnapshotAt: null },
        importedBy: null, viewer, ranks: [], roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function Harness(): JSX.Element | null {
    const { data } = useGuildPage(7);
    return data ? <HubNotifyBell page={data} /> : <span data-testid="loading" />;
}

interface Calls { writes: string[] }

function serve(viewer: GuildViewerAccess, opts: { fail?: boolean; gate?: Promise<void> } = {}): Calls {
    const calls: Calls = { writes: [] };
    let muted = viewer.notificationsMuted;
    const write = (next: boolean) => async ({ request }: { request: Request }) => {
        calls.writes.push(request.method);
        if (opts.gate) await opts.gate;
        if (opts.fail) return HttpResponse.json({ message: 'boom' }, { status: 500 });
        muted = next;
        return HttpResponse.json({ guildId: 7, muted: next });
    };
    server.use(
        http.get(API, () => HttpResponse.json(makePage(muted === undefined ? viewer : { ...viewer, notificationsMuted: muted }))),
        http.post(`${API}/notification-mute`, write(true)),
        http.delete(`${API}/notification-mute`, write(false)),
    );
    return calls;
}

const MEMBER: GuildViewerAccess = { role: 'member', canEdit: false, canManageEditors: false, notificationsMuted: false };
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    window.matchMedia = (query: string): MediaQueryList => ({
        matches: query.includes('min-width'), media: query, onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
    });
});
afterEach(() => { window.matchMedia = originalMatchMedia; });

async function openSwitch(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await user.click(await screen.findByTestId('hub-notify-bell'));
    return screen.findByTestId('hub-notify-switch');
}

/** The bell's anchor spans x 1160–1200; the 320px popover sits wherever its inline `left` puts it. */
function stubRects() {
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const isPopover = this.getAttribute('data-testid') === 'hub-notify-popover';
        const left = isPopover && this instanceof HTMLElement ? parseFloat(this.style.left) || 0 : 1160;
        const width = isPopover ? 320 : 40;
        return { x: left, y: 100, left, top: 100, width, height: 40, right: left + width, bottom: 140, toJSON: () => ({}) };
    });
}

describe('HubNotifyBell', () => {
    it('right-aligns the popover to the bell (the hero puts the bell at the right edge)', async () => {
        serve(MEMBER);
        const rect = stubRects();
        const user = userEvent.setup();
        renderWithProviders(<Harness />);
        await user.click(await screen.findByTestId('hub-notify-bell'));
        const popover = await screen.findByTestId('hub-notify-popover');
        await waitFor(() => expect(popover.style.left).toBe('880px'));
        rect.mockRestore();
    });

    it('mutes with POST and the label flips to muted', async () => {
        const calls = serve(MEMBER);
        const user = userEvent.setup();
        renderWithProviders(<Harness />);
        const bell = await screen.findByTestId('hub-notify-bell');
        expect(bell).toHaveAttribute('aria-label', 'Notifications for Iron Vanguard: on');
        await user.click(await openSwitch(user));
        await waitFor(() => expect(calls.writes).toEqual(['POST']));
        await waitFor(() => expect(bell).toHaveAttribute('aria-label', 'Notifications for Iron Vanguard: muted'));
    });

    it('unmutes a muted group with DELETE', async () => {
        const calls = serve({ ...MEMBER, role: 'officer', notificationsMuted: true });
        const user = userEvent.setup();
        renderWithProviders(<Harness />);
        const toggle = await openSwitch(user);
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        await user.click(toggle);
        await waitFor(() => expect(calls.writes).toEqual(['DELETE']));
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    });

    it('shows the mute optimistically, then rolls back and toasts on a 500', async () => {
        let release = (): void => undefined;
        const gate = new Promise<void>((r) => { release = r; });
        serve(MEMBER, { fail: true, gate });
        const user = userEvent.setup();
        renderWithProviders(<Harness />);
        const toggle = await openSwitch(user);
        await user.click(toggle);
        const bell = screen.getByTestId('hub-notify-bell');
        await waitFor(() => expect(bell).toHaveAttribute('aria-label', 'Notifications for Iron Vanguard: muted'));
        release();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update notifications for this group'));
        await waitFor(() => expect(bell).toHaveAttribute('aria-label', 'Notifications for Iron Vanguard: on'));
    });

    it('is hidden for a visitor', async () => {
        serve({ role: 'visitor', canEdit: false, canManageEditors: false });
        renderWithProviders(<Harness />);
        await waitFor(() => expect(screen.queryByTestId('loading')).not.toBeInTheDocument());
        expect(screen.queryByTestId('hub-notify-bell')).not.toBeInTheDocument();
    });

    it('is hidden for staff who lead the page by rights but are not members (no notificationsMuted key)', async () => {
        serve({ role: 'leader', canEdit: true, canManageEditors: true });
        renderWithProviders(<Harness />);
        await waitFor(() => expect(screen.queryByTestId('loading')).not.toBeInTheDocument());
        expect(screen.queryByTestId('hub-notify-bell')).not.toBeInTheDocument();
    });
});
