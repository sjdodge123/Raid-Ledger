/**
 * ROK-1797 — the per-game notification bell on the game page: it opens a
 * panel (popover ≥1024px, BottomSheet below), the Switch inside writes the
 * mute, a failed write rolls back, and `?action=notifications&notif=` opens
 * the panel, marks the DM read and leaves the URL clean in one pass.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { setAccessToken } from '../../lib/api/access-token-store';
import { toast } from '../../lib/toast';
import { GameNotifyBell } from './game-notify-bell';

const API = 'http://localhost:3000';
const GAME_ID = 7;
const markRead = vi.fn();

vi.mock('../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../hooks/use-notifications', () => ({ useNotifications: () => ({ markRead }) }));

const originalMatchMedia = window.matchMedia;
function setDesktop(isDesktop: boolean): void {
    window.matchMedia = (query: string): MediaQueryList => ({
        matches: isDesktop && query.includes('min-width'), media: query, onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
    });
}

interface Calls { writes: string[] }

/** Interest GET reflects the server-side mute; POST/DELETE flip it unless `fail`. */
function seed(initiallyMuted: boolean, opts: { fail?: boolean; gate?: Promise<void> } = {}): Calls {
    const calls: Calls = { writes: [] };
    let muted = initiallyMuted;
    const write = (next: boolean) => async ({ request }: { request: Request }) => {
        calls.writes.push(request.method);
        if (opts.gate) await opts.gate;
        if (opts.fail) return HttpResponse.json({ message: 'boom' }, { status: 500 });
        muted = next;
        return HttpResponse.json({ gameId: GAME_ID, muted: next });
    };
    server.use(
        http.get(`${API}/games/${GAME_ID}/interest`, () =>
            HttpResponse.json({ wantToPlay: false, count: 0, notificationsMuted: muted })),
        http.post(`${API}/games/${GAME_ID}/notification-mute`, write(true)),
        http.delete(`${API}/games/${GAME_ID}/notification-mute`, write(false)),
    );
    return calls;
}

function LocationProbe() {
    const { search } = useLocation();
    return <output data-testid="search">{search}</output>;
}

function renderBell(url = `/games/${GAME_ID}`) {
    return renderWithProviders(
        <><GameNotifyBell gameId={GAME_ID} gameName="Valheim" /><LocationProbe /></>,
        { initialEntries: [url] },
    );
}

beforeEach(() => { setAccessToken('test-token'); markRead.mockClear(); vi.mocked(toast.error).mockClear(); });
afterEach(() => { window.matchMedia = originalMatchMedia; });

describe('GameNotifyBell — desktop popover', () => {
    beforeEach(() => setDesktop(true));

    it('opens a dialog whose Switch mutes the game, and Esc returns focus to the bell', async () => {
        const calls = seed(false);
        const user = userEvent.setup();
        renderBell();
        const bell = await screen.findByTestId('game-notify-bell');
        await waitFor(() => expect(bell).toHaveAttribute('aria-label', 'Notifications for Valheim: on'));
        expect(bell).toHaveAttribute('aria-haspopup', 'dialog');
        expect(bell).toHaveAttribute('aria-expanded', 'false');

        await user.click(bell);
        const dialog = await screen.findByRole('dialog', { name: 'Notifications for Valheim' });
        expect(bell).toHaveAttribute('aria-expanded', 'true');
        expect(within(dialog).getByText('Muting only silences notifications. Your heart stays as it is.')).toBeInTheDocument();
        expect(within(dialog).getByRole('link', { name: 'All notification settings →' }))
            .toHaveAttribute('href', '/profile/notifications#notif-subscribed_game');

        const toggle = within(dialog).getByTestId('game-notify-switch');
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
        await user.click(toggle);
        await waitFor(() => expect(calls.writes).toEqual(['POST']));
        await waitFor(() => expect(bell).toHaveAttribute('aria-label', 'Notifications for Valheim: muted'));

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(bell).toHaveFocus();
    });

    it('unmutes a muted game with DELETE', async () => {
        const calls = seed(true);
        const user = userEvent.setup();
        renderBell();
        const bell = await screen.findByTestId('game-notify-bell');
        await waitFor(() => expect(bell).toHaveAttribute('aria-label', 'Notifications for Valheim: muted'));
        await user.click(bell);
        const toggle = await screen.findByTestId('game-notify-switch');
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        await user.click(toggle);
        await waitFor(() => expect(calls.writes).toEqual(['DELETE']));
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    });

    it('shows the mute optimistically, then rolls back and toasts when the write fails', async () => {
        let release = (): void => undefined;
        const gate = new Promise<void>((r) => { release = r; });
        seed(false, { fail: true, gate });
        const user = userEvent.setup();
        renderBell();
        await user.click(await screen.findByTestId('game-notify-bell'));
        const toggle = await screen.findByTestId('game-notify-switch');
        await waitFor(() => expect(toggle).not.toBeDisabled());
        await user.click(toggle);
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
        release();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update notifications for this game'));
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    });
});

describe('GameNotifyBell — desktop popover focus exit', () => {
    beforeEach(() => setDesktop(true));

    it('a Tab past the last link closes the popover and returns focus to the bell', async () => {
        seed(false);
        const user = userEvent.setup();
        renderBell();
        const bell = await screen.findByTestId('game-notify-bell');
        await user.click(bell);
        const dialog = await screen.findByRole('dialog', { name: 'Notifications for Valheim' });
        await waitFor(() => expect(within(dialog).getByTestId('game-notify-switch')).not.toBeDisabled());
        await user.tab();
        expect(within(dialog).getByTestId('game-notify-switch')).toHaveFocus();
        await user.tab();
        expect(within(dialog).getByRole('link', { name: 'All notification settings →' })).toHaveFocus();
        await user.tab();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(bell).toHaveFocus();
    });

    it('Shift+Tab from the popover itself closes it and returns focus to the bell', async () => {
        seed(false);
        const user = userEvent.setup();
        renderBell();
        const bell = await screen.findByTestId('game-notify-bell');
        await user.click(bell);
        const dialog = await screen.findByRole('dialog', { name: 'Notifications for Valheim' });
        await waitFor(() => expect(dialog).toHaveFocus());
        await user.tab({ shift: true });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(bell).toHaveFocus();
    });
});

describe('GameNotifyBell — phone sheet', () => {
    it('opens a BottomSheet below 1024px instead of the popover', async () => {
        setDesktop(false);
        seed(false);
        const user = userEvent.setup();
        renderBell();
        await user.click(await screen.findByTestId('game-notify-bell'));
        expect(await screen.findByText('Notifications for Valheim')).toBeInTheDocument();
        expect(screen.getByTestId('game-notify-switch')).toBeInTheDocument();
        expect(screen.queryByTestId('game-notify-popover')).not.toBeInTheDocument();
    });
});

const NOTIF_ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

describe('GameNotifyBell — deep link', () => {
    beforeEach(() => setDesktop(true));

    it('?action=notifications&notif= opens the panel, marks the DM read and strips both params', async () => {
        seed(false);
        renderBell(`/games/${GAME_ID}?action=notifications&notif=${NOTIF_ID}&tab=x`);
        expect(await screen.findByRole('dialog', { name: 'Notifications for Valheim' })).toBeInTheDocument();
        expect(markRead).toHaveBeenCalledWith(NOTIF_ID);
        await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(/^\?tab=x$/));
    });

    it('leaves an unrelated ?action= alone and keeps the panel closed', async () => {
        seed(false);
        renderBell(`/games/${GAME_ID}?action=other`);
        await waitFor(() => expect(screen.getByTestId('game-notify-bell'))
            .toHaveAttribute('aria-label', 'Notifications for Valheim: on'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByTestId('search')).toHaveTextContent('?action=other');
    });
});
