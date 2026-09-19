/**
 * ROK-1618 (AC4/AC5/AC7/AC8) — the leading card's "Poll actions ⋯" menu.
 *
 * The lock that ends a poll left the toolbar's floating cyan bar and now
 * shares this menu with the new Rally nudge. The menu is the Manage-poll
 * recipe: a `role="menu"` popover from 1024px up, a `BottomSheet` below.
 *
 * The rally mutation is exercised through the REAL `useRallyNonVoters` hook
 * with only the transport (`rallyNonVoters`) and the toast stubbed, so the
 * success copy asserted here is the contract's own `summariseRally` and a
 * refusal's copy is the server's `message`, verbatim.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingLeaderMenu } from '../SchedulingLeaderMenu';
import { rallyNonVoters } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';

vi.mock('../../../../lib/api-client', () => ({
    rallyNonVoters: vi.fn(),
}));
vi.mock('../../../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

/** Force `useMediaQuery('(min-width: 1024px)')` to a known answer. */
function stubViewport(desktop: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: desktop && query.includes('1024'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

const onLock = vi.fn();

function renderMenu(
    overrides: Partial<Parameters<typeof SchedulingLeaderMenu>[0]> = {},
): void {
    renderWithProviders(
        <SchedulingLeaderMenu
            lineupId={7}
            matchId={500}
            readOnly={false}
            canLock
            leadingTimeLabel="Wed 10 Jun, 20:00"
            pendingVoterCount={3}
            onLock={onLock}
            {...overrides}
        />,
    );
}

const trigger = (): HTMLElement => screen.getByTestId('scheduling-leader-menu');

beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(true);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('SchedulingLeaderMenu — who sees the ⋯ (AC4)', () => {
    it('renders nothing for a viewer who cannot lock the poll', () => {
        renderMenu({ canLock: false });
        expect(
            screen.queryByTestId('scheduling-leader-menu'),
        ).not.toBeInTheDocument();
    });

    it('renders nothing on a read-only poll', () => {
        renderMenu({ readOnly: true });
        expect(
            screen.queryByTestId('scheduling-leader-menu'),
        ).not.toBeInTheDocument();
    });

    it('gives the organiser a ≥44px "Poll actions" trigger (AC7)', () => {
        renderMenu();
        expect(trigger()).toHaveAttribute('aria-label', 'Poll actions');
        expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
        expect(trigger()).toHaveAttribute('aria-expanded', 'false');
        const classes = Array.from(trigger().classList);
        expect(classes).toContain('min-h-[44px]');
        expect(classes).toContain('min-w-[44px]');
    });
});

describe('SchedulingLeaderMenu — both actions live here (AC5)', () => {
    it('opens a role="menu" popover carrying Lock this time AND Rally', async () => {
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());

        const menu = screen.getByTestId('scheduling-leader-menu-popover');
        expect(menu).toHaveAttribute('role', 'menu');
        expect(trigger()).toHaveAttribute('aria-expanded', 'true');
        expect(
            screen.getByRole('menuitem', {
                name: 'Lock this time — Wed 10 Jun, 20:00',
            }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('menuitem', { name: /^Rally/ }),
        ).toBeInTheDocument();
    });

    it('routes the Lock item to the poll-ending lock flow', async () => {
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());
        await user.click(screen.getByTestId('scheduling-leader-lock'));
        expect(onLock).toHaveBeenCalledTimes(1);
    });

    it('draws a bottom sheet instead of a popover below 1024px', async () => {
        stubViewport(false);
        const user = userEvent.setup();
        renderMenu();
        expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog');
        await user.click(trigger());

        expect(
            screen.getByTestId('scheduling-leader-menu-sheet'),
        ).toBeInTheDocument();
        expect(
            screen.queryByTestId('scheduling-leader-menu-popover'),
        ).not.toBeInTheDocument();
        // The sheet's rows are the SAME two actions, tappable.
        await user.click(screen.getByTestId('scheduling-leader-lock'));
        expect(onLock).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape and puts focus back on the trigger', async () => {
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());
        await user.keyboard('{Escape}');

        await waitFor(() => {
            expect(trigger()).toHaveAttribute('aria-expanded', 'false');
        });
        expect(trigger()).toHaveFocus();
    });

    it('survives a mousedown inside a portalled confirm dialog', async () => {
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());
        // The lock confirm modal portals to document.body with role="dialog";
        // an outside-click listener that did not exempt it would close the
        // menu (and unmount the item) out from under the modal it just opened.
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        const inner = document.createElement('button');
        dialog.appendChild(inner);
        document.body.appendChild(dialog);
        await user.click(inner);

        expect(trigger()).toHaveAttribute('aria-expanded', 'true');
        document.body.removeChild(dialog);
    });
});

describe('SchedulingLeaderMenu — the Rally row (AC3/AC8)', () => {
    it('is present but disabled with "Everyone has voted" at zero pending', async () => {
        const user = userEvent.setup();
        renderMenu({ pendingVoterCount: 0 });
        await user.click(trigger());

        const row = screen.getByTestId('scheduling-leader-rally');
        expect(row).toBeDisabled();
        expect(row).toHaveAttribute('aria-label', 'Rally — Everyone has voted');
    });

    it('names the outstanding voters when there are some', async () => {
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());

        const row = screen.getByTestId('scheduling-leader-rally');
        expect(row).toBeEnabled();
        expect(row).toHaveAttribute('aria-label', "Rally — 3 haven't voted");
    });

    it('toasts the contract\'s own summary on success', async () => {
        vi.mocked(rallyNonVoters).mockResolvedValue({
            pending: 3,
            nudged: 2,
            skipped: 1,
            cooldownUntil: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        });
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());
        await user.click(screen.getByTestId('scheduling-leader-rally'));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Nudged 2 members');
        });
        expect(rallyNonVoters).toHaveBeenCalledWith(7, 500);
    });

    it('disables itself for the server-reported cooldown after a success', async () => {
        vi.mocked(rallyNonVoters).mockResolvedValue({
            pending: 3,
            nudged: 3,
            skipped: 0,
            cooldownUntil: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        });
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());
        await user.click(screen.getByTestId('scheduling-leader-rally'));

        await waitFor(() => {
            expect(screen.getByTestId('scheduling-leader-rally')).toBeDisabled();
        });
        expect(
            screen.getByTestId('scheduling-leader-rally'),
        ).toHaveAttribute('aria-label', 'Rallied ✓ — You can do this again in 6h');
    });

    it('toasts the server message verbatim when the 6h cooldown 429s', async () => {
        const message = 'You rallied this poll recently — try again later';
        vi.mocked(rallyNonVoters).mockRejectedValue(new Error(message));
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());
        await user.click(screen.getByTestId('scheduling-leader-rally'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith(message);
        });
        // ...and the row stays usable, because no cooldown was reported.
        expect(screen.getByTestId('scheduling-leader-rally')).toBeEnabled();
    });
});
