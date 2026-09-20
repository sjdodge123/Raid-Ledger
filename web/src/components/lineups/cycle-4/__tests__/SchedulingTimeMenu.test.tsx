/**
 * ROK-1618 (AC4/AC5/AC7/AC8) + ROK-1635 (AC3/AC4/AC5) — the ⋯ menu that every
 * time card carries.
 *
 * The lock that ends a poll left the toolbar's floating cyan bar in ROK-1618
 * and shares this menu with the Rally nudge; ROK-1635 deleted the ladder's
 * separate inline `Lock this time →` button and put THIS component on every
 * row too, so a row and the leading card offer one control set, not two. The
 * menu is the Manage-poll recipe: a `role="menu"` popover from 1024px up, a
 * `BottomSheet` below.
 *
 * The rally mutation is exercised through the REAL `useRallyNonVoters` hook
 * with only the transport (`rallyNonVoters`) and the toast stubbed, so the
 * success copy asserted here is the contract's own `summariseRally` and a
 * refusal's copy is the server's `message`, verbatim.
 *
 * The cooldown is no longer owned by the menu (ROK-1635 §3.4 — it is per POLL,
 * so ONE `useArmedCooldown` is hoisted into the composite and shared). The
 * harness below owns it exactly as the composite does, which is what lets the
 * "every menu goes cold after one rally" case be written at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import {
    SchedulingTimeMenu,
    type SchedulingTimeMenuProps,
} from '../SchedulingTimeMenu';
import { useArmedCooldown } from '../use-rally-cooldown';
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

function slotFixture(id: number): ScheduleSlotWithVotesDto {
    return {
        id,
        proposedTime: new Date(Date.now() + 86_400_000).toISOString(),
        votes: [],
        noVotes: [],
    } as unknown as ScheduleSlotWithVotesDto;
}

type Overrides = Partial<Omit<SchedulingTimeMenuProps, 'cooldown'>>;

/**
 * The composite's ownership, in miniature: one `useArmedCooldown` shared by
 * every menu rendered below it.
 */
function Harness({ menus }: { menus: Overrides[] }): React.JSX.Element {
    const cooldown = useArmedCooldown();
    return (
        <>
            {menus.map((overrides, i) => (
                <SchedulingTimeMenu
                    key={i}
                    lineupId={7}
                    matchId={500}
                    slot={slotFixture(1001)}
                    timeLabel="Wed 10 Jun, 20:00"
                    canManage
                    canLock
                    readOnly={false}
                    pendingVoterCount={3}
                    cooldown={cooldown}
                    testIdPrefix="scheduling-leader"
                    onLock={onLock}
                    {...overrides}
                />
            ))}
        </>
    );
}

function renderMenu(overrides: Overrides = {}): void {
    renderWithProviders(<Harness menus={[overrides]} />);
}

const trigger = (): HTMLElement => screen.getByTestId('scheduling-leader-menu');

beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(true);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('SchedulingTimeMenu — who sees the ⋯ (AC4 / ROK-1635 OQ-2)', () => {
    it('renders nothing for a viewer who cannot manage the poll', () => {
        renderMenu({ canManage: false });
        expect(
            screen.queryByTestId('scheduling-leader-menu'),
        ).not.toBeInTheDocument();
    });

    it('renders no menu at all — not an empty one — for a non-organiser row', () => {
        renderMenu({ canManage: false, testIdPrefix: 'scheduling-slot' });
        expect(screen.queryByTestId('scheduling-slot-menu')).not.toBeInTheDocument();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('renders nothing on a read-only poll', () => {
        renderMenu({ readOnly: true });
        expect(
            screen.queryByTestId('scheduling-leader-menu'),
        ).not.toBeInTheDocument();
    });

    it('renders nothing on a row whose time has passed (neither item survives)', () => {
        // ROK-1610 already hid Lock there; ROK-1635 hides Rally too, because
        // the server refuses a rally on a past time. Zero items → no trigger.
        renderMenu({
            testIdPrefix: 'scheduling-slot',
            canLock: false,
            canRally: false,
        });
        expect(screen.queryByTestId('scheduling-slot-menu')).not.toBeInTheDocument();
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

describe('SchedulingTimeMenu — both actions live here (AC5)', () => {
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

    it('puts the leading time on the Lock item\'s second line, keeping its name', async () => {
        // The 232px popover truncates "Lock this time — <long time>" away, so
        // the menu draws a short title with the time below it. The accessible
        // name (asserted above and by the Playwright spec) is unchanged.
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());

        expect(screen.getByText('Lock this time')).toBeVisible();
        expect(screen.getByText('Wed 10 Jun, 20:00')).toBeVisible();
    });

    it('routes the Lock item to the poll-ending lock flow', async () => {
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());
        await user.click(screen.getByTestId('scheduling-leader-lock'));
        expect(onLock).toHaveBeenCalledTimes(1);
        // Lock opens a confirm modal, so the menu still closes behind it.
        await waitFor(() => {
            expect(trigger()).toHaveAttribute('aria-expanded', 'false');
        });
    });

    it('keeps the desktop menu open when Rally is selected', async () => {
        // Rally is an in-place action whose whole feedback loop (Rallying… →
        // Rallied ✓ → "again in 6h") lives in the row: closing the menu on
        // select hides every one of those states from the organiser.
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

        expect(trigger()).toHaveAttribute('aria-expanded', 'true');
        await waitFor(() => {
            expect(screen.getByText('You can do this again in 6h')).toBeVisible();
        });
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

describe('SchedulingTimeMenu — a row gets the SAME menu (ROK-1635 AC3)', () => {
    it('offers a row the same two items, under the scheduling-slot testids', async () => {
        const user = userEvent.setup();
        renderMenu({
            testIdPrefix: 'scheduling-slot',
            slot: slotFixture(1002),
            timeLabel: 'Thu 11 Jun, 21:00',
        });
        const rowTrigger = screen.getByTestId('scheduling-slot-menu');
        expect(rowTrigger).toHaveAttribute(
            'aria-label',
            'Time actions — Thu 11 Jun, 21:00',
        );
        await user.click(rowTrigger);

        const popover = screen.getByTestId('scheduling-slot-menu-popover');
        const names = within(popover)
            .getAllByRole('menuitem')
            .map((el) => el.getAttribute('aria-label'));
        expect(names).toEqual([
            'Lock this time — Thu 11 Jun, 21:00',
            "Rally — 3 haven't answered this time",
        ]);
        expect(screen.getByTestId('scheduling-slot-lock')).toBeInTheDocument();
        expect(screen.getByTestId('scheduling-slot-rally')).toBeInTheDocument();
    });

    it('carries organiser actions ONLY — vote and "Doesn\'t work" stay on the card (AC4)', async () => {
        const user = userEvent.setup();
        renderMenu({ testIdPrefix: 'scheduling-slot' });
        await user.click(screen.getByTestId('scheduling-slot-menu'));

        const items = screen.getAllByRole('menuitem');
        expect(items).toHaveLength(2);
        for (const item of items) {
            expect(item.getAttribute('aria-label')).not.toMatch(
                /vote|doesn.?t work/i,
            );
        }
    });

    it('rallies THAT row\'s time, not the leading one', async () => {
        vi.mocked(rallyNonVoters).mockResolvedValue({
            pending: 2,
            nudged: 2,
            skipped: 0,
            cooldownUntil: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        });
        const user = userEvent.setup();
        renderMenu({ testIdPrefix: 'scheduling-slot', slot: slotFixture(1002) });
        await user.click(screen.getByTestId('scheduling-slot-menu'));
        await user.click(screen.getByTestId('scheduling-slot-rally'));

        await waitFor(() => {
            expect(rallyNonVoters).toHaveBeenCalledWith(7, 500, 1002);
        });
    });

    it('hides only the Lock item on a row the expired poll may not finish at', async () => {
        const user = userEvent.setup();
        renderMenu({ testIdPrefix: 'scheduling-slot', canLock: false });
        await user.click(screen.getByTestId('scheduling-slot-menu'));

        expect(screen.queryByTestId('scheduling-slot-lock')).not.toBeInTheDocument();
        expect(screen.getByTestId('scheduling-slot-rally')).toBeInTheDocument();
    });

    it('takes every menu on the page cold after ONE rally (§3.4, per-poll 6h)', async () => {
        // The server's cooldown key is per POLL, so N independently-idle Rally
        // rows would 429 on rows 2..N. One hoisted cooldown, one arm.
        vi.mocked(rallyNonVoters).mockResolvedValue({
            pending: 3,
            nudged: 3,
            skipped: 0,
            cooldownUntil: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        });
        const user = userEvent.setup();
        renderWithProviders(
            <Harness
                menus={[
                    {},
                    { testIdPrefix: 'scheduling-slot', slot: slotFixture(1002) },
                ]}
            />,
        );
        await user.click(trigger());
        await user.click(screen.getByTestId('scheduling-leader-rally'));
        await waitFor(() => {
            expect(screen.getByTestId('scheduling-leader-rally')).toBeDisabled();
        });

        const rowRally = screen.getByTestId('scheduling-slot-rally');
        expect(rowRally).toBeDisabled();
        expect(rowRally).toHaveAttribute(
            'aria-label',
            'Rallied ✓ — You can do this again in 6h',
        );
    });
});

describe('SchedulingTimeMenu — the Rally row (AC3/AC8)', () => {
    it('is present but disabled with "Everyone has answered this time" at zero pending', async () => {
        const user = userEvent.setup();
        renderMenu({ pendingVoterCount: 0 });
        await user.click(trigger());

        const row = screen.getByTestId('scheduling-leader-rally');
        expect(row).toBeDisabled();
        expect(row).toHaveAttribute(
            'aria-label',
            'Rally — Everyone has answered this time',
        );
        // AC8 asks the item to READ the empty state: a sighted mouse user on
        // desktop never hears the accessible name.
        expect(
            screen.getByText('Everyone has answered this time'),
        ).toBeVisible();
    });

    it('names the members who have not answered the leading time', async () => {
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());

        const row = screen.getByTestId('scheduling-leader-rally');
        expect(row).toBeEnabled();
        expect(row).toHaveAttribute(
            'aria-label',
            "Rally — 3 haven't answered this time",
        );
    });

    it('says it in the singular for exactly one outstanding member', async () => {
        const user = userEvent.setup();
        renderMenu({ pendingVoterCount: 1 });
        await user.click(trigger());

        expect(screen.getByTestId('scheduling-leader-rally')).toHaveAttribute(
            'aria-label',
            "Rally — 1 hasn't answered this time",
        );
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
        // ROK-1635: the card names its own slot too, so what the organiser
        // sees is exactly what the server rallies.
        expect(rallyNonVoters).toHaveBeenCalledWith(7, 500, 1001);
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

    it('keeps the cooldown after the phone sheet is closed and reopened', async () => {
        // The sheet branch is mounted only while open, so a cooldown owned by
        // the row itself dies on close and the reopened sheet offers a Rally
        // the server answers with a 429.
        vi.mocked(rallyNonVoters).mockResolvedValue({
            pending: 3,
            nudged: 3,
            skipped: 0,
            cooldownUntil: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        });
        stubViewport(false);
        const user = userEvent.setup();
        renderMenu();
        await user.click(trigger());
        await user.click(screen.getByTestId('scheduling-leader-rally'));
        await waitFor(() => {
            expect(screen.getByTestId('scheduling-leader-rally')).toBeDisabled();
        });

        await user.click(screen.getByRole('button', { name: 'Close sheet' }));
        await waitFor(() => {
            expect(
                screen.queryByTestId('scheduling-leader-menu-sheet'),
            ).not.toBeInTheDocument();
        });
        await user.click(trigger());

        const row = screen.getByTestId('scheduling-leader-rally');
        expect(row).toBeDisabled();
        expect(row).toHaveAttribute(
            'aria-label',
            'Rallied ✓ — You can do this again in 6h',
        );
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
