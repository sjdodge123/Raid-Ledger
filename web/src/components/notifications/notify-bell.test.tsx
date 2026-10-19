/**
 * ROK-1832 — the shared `NotifyBell` primitive (generalised from ROK-1797):
 * the trigger states the subject's state, opens a popover ≥1024px or a
 * `BottomSheet` below, and the Switch inside reports the new mute.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { NotifyBell, type NotifyBellProps } from './notify-bell';

const originalMatchMedia = window.matchMedia;
function setDesktop(isDesktop: boolean): void {
    window.matchMedia = (query: string): MediaQueryList => ({
        matches: isDesktop && query.includes('min-width'), media: query, onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
    });
}

const onToggle = vi.fn<(muted: boolean) => void>();

function renderBell(overrides: Partial<NotifyBellProps> = {}) {
    const props: NotifyBellProps = {
        subjectName: 'Iron Vanguard', muted: false, isReady: true, isPending: false, onToggle,
        settingsHref: '/profile/notifications#notif-hub_leader_post', testIdPrefix: 'hub-notify',
        mutedHint: 'Leader posts and events tagged to this group. Muting keeps you in the group.', ...overrides,
    };
    return renderWithProviders(<NotifyBell {...props} />);
}

beforeEach(() => onToggle.mockClear());
afterEach(() => { window.matchMedia = originalMatchMedia; vi.restoreAllMocks(); });

/**
 * Lay the page out: the bell's anchor spans x 1160–1200 and the popover is 320px
 * wide, sitting (untransformed) wherever its inline `left` puts it.
 */
function stubRects(): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const isPopover = this.getAttribute('data-testid') === 'hub-notify-popover';
        const left = isPopover && this instanceof HTMLElement ? parseFloat(this.style.left) || 0 : 1160;
        const width = isPopover ? 320 : 40;
        const height = isPopover ? 200 : 40;
        return { x: left, y: 100, left, top: 100, width, height, right: left + width, bottom: 100 + height, toJSON: () => ({}) };
    });
}

describe('NotifyBell', () => {
    it('labels the trigger with the subject and its state', () => {
        setDesktop(true);
        const { unmount } = renderBell();
        expect(screen.getByTestId('hub-notify-bell')).toHaveAttribute('aria-label', 'Notifications for Iron Vanguard: on');
        unmount();
        renderBell({ muted: true });
        expect(screen.getByTestId('hub-notify-bell')).toHaveAttribute('aria-label', 'Notifications for Iron Vanguard: muted');
    });

    it('≥1024px opens a popover dialog with the hint, the settings link, and a Switch that mutes', async () => {
        setDesktop(true);
        const user = userEvent.setup();
        renderBell();
        await user.click(screen.getByTestId('hub-notify-bell'));
        const dialog = await screen.findByRole('dialog', { name: 'Notifications for Iron Vanguard' });
        expect(dialog).toHaveAttribute('data-testid', 'hub-notify-popover');
        expect(within(dialog).getByText('Leader posts and events tagged to this group. Muting keeps you in the group.')).toBeInTheDocument();
        expect(within(dialog).getByRole('link', { name: 'All notification settings →' }))
            .toHaveAttribute('href', '/profile/notifications#notif-hub_leader_post');
        const toggle = within(dialog).getByRole('switch', { name: 'Notify me about Iron Vanguard' });
        await user.click(toggle);
        expect(onToggle).toHaveBeenCalledWith(true);
    });

    it('opens the popover from the bell\'s left edge by default', async () => {
        setDesktop(true);
        const user = userEvent.setup();
        renderBell();
        await user.click(screen.getByTestId('hub-notify-bell'));
        expect(await screen.findByTestId('hub-notify-popover')).not.toHaveClass('-translate-x-full');
    });

    it('align="end" right-aligns the popover to the bell so it stays in the viewport', async () => {
        setDesktop(true);
        const user = userEvent.setup();
        stubRects();
        renderBell({ align: 'end' });
        await user.click(screen.getByTestId('hub-notify-bell'));
        const popover = await screen.findByTestId('hub-notify-popover');
        await waitFor(() => expect(popover.style.left).toBe('880px'));
        expect(popover.className).not.toMatch(/translate/);
    });

    it('<1024px opens a BottomSheet instead of the popover', async () => {
        setDesktop(false);
        const user = userEvent.setup();
        renderBell({ muted: true });
        await user.click(screen.getByTestId('hub-notify-bell'));
        expect(screen.queryByTestId('hub-notify-popover')).not.toBeInTheDocument();
        await user.click(await screen.findByTestId('hub-notify-switch'));
        expect(onToggle).toHaveBeenCalledWith(false);
    });

    it('disables the Switch until ready and while a write is pending', async () => {
        setDesktop(true);
        const user = userEvent.setup();
        renderBell({ isPending: true });
        await user.click(screen.getByTestId('hub-notify-bell'));
        expect(await screen.findByTestId('hub-notify-switch')).toBeDisabled();
    });
});
