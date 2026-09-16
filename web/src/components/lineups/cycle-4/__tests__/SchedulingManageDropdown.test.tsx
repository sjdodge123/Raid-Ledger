/**
 * ROK-1585 (AC2) — the desktop "Manage poll ⋯" dropdown.
 *
 * From 1024px up the scheduling hero's three creator/operator actions collapse
 * into ONE trigger opening a 232px `role="menu"` popover. The three action
 * components stay MOUNTED while the menu is closed: each owns its modal, and
 * the item click that opens a modal also closes the menu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingManageDropdown } from '../SchedulingManageDropdown';

vi.mock('react-router-dom', async () => {
    const actual =
        await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => vi.fn() };
});

let remindPending = false;
vi.mock('../../../../hooks/use-scheduling', () => ({
    useAddPollMembers: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRemindVoters: () => ({
        mutate: vi.fn(),
        isPending: remindPending,
        isSuccess: false,
        reset: vi.fn(),
    }),
    useCancelSchedulePoll: () => ({ mutate: vi.fn(), isPending: false }),
}));

let viewer: { id: number; role: string } = { id: 10, role: 'operator' };
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: viewer }),
    isOperatorOrAdmin: (u: { role?: string } | null) =>
        u?.role === 'operator' || u?.role === 'admin',
}));

const match = {
    lineupCreatedById: 10,
    members: [{ userId: 1 }, { userId: 2 }, { userId: 3 }, { userId: 4 }],
} as unknown as MatchDetailResponseDto;

function renderDropdown(readOnly = false): void {
    renderWithProviders(
        <SchedulingManageDropdown
            lineupId={5}
            matchId={9}
            match={match}
            readOnly={readOnly}
            uniqueVoterCount={3}
        />,
    );
}

const trigger = (): HTMLElement => screen.getByTestId('scheduling-manage');
const menu = (): HTMLElement => screen.getByTestId('scheduling-manage-menu');

describe('SchedulingManageDropdown (ROK-1585)', () => {
    beforeEach(() => {
        viewer = { id: 10, role: 'operator' };
        remindPending = false;
    });

    it('shows a closed "Manage poll ⋯" menu trigger to the creator/operator', () => {
        renderDropdown();
        expect(trigger()).toHaveTextContent('Manage poll');
        expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
        expect(trigger()).toHaveAttribute('aria-expanded', 'false');
        expect(trigger().className).toContain('lg:min-h-[36px]');
        expect(menu()).not.toBeVisible();
    });

    it('renders nothing for a plain member', () => {
        viewer = { id: 99, role: 'member' };
        renderDropdown();
        expect(screen.queryByTestId('scheduling-manage')).toBeNull();
    });

    it('renders nothing in a read-only poll', () => {
        renderDropdown(true);
        expect(screen.queryByTestId('scheduling-manage')).toBeNull();
    });

    it('opens a 232px menu: Add · Remind · separator · Cancel', async () => {
        renderDropdown();
        await userEvent.click(trigger());
        expect(trigger()).toHaveAttribute('aria-expanded', 'true');
        expect(menu()).toBeVisible();
        expect(menu()).toHaveAttribute('role', 'menu');
        expect(menu().className).toContain('w-[232px]');
        const children = Array.from(menu().children).map(
            (el) => el.getAttribute('role') + ':' + (el.getAttribute('aria-label') ?? ''),
        );
        expect(children).toEqual([
            'menuitem:Add Participants',
            'menuitem:Remind Voters',
            'separator:',
            'menuitem:Cancel Poll',
        ]);
        const items = within(menu()).getAllByRole('menuitem');
        expect(items[0].className).toContain('min-h-[40px]');
        expect(items).toHaveLength(3);
        expect(items[2].className).toContain('text-red-400');
        // Menu density: no sublines.
        expect(menu()).not.toHaveTextContent('invite more people');
    });

    it('opening focuses the first menuitem; ArrowDown / ArrowUp / Home / End move between items', async () => {
        renderDropdown();
        await userEvent.click(trigger());
        const items = within(menu()).getAllByRole('menuitem');
        expect(items[0]).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}');
        expect(items[1]).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}{ArrowDown}');
        expect(items[0]).toHaveFocus(); // wraps past the last
        await userEvent.keyboard('{ArrowUp}');
        expect(items[2]).toHaveFocus(); // wraps before the first
        await userEvent.keyboard('{Home}');
        expect(items[0]).toHaveFocus();
        await userEvent.keyboard('{End}');
        expect(items[2]).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(trigger()).toHaveFocus();
    });

    it('Esc closes the menu and returns focus to the trigger', async () => {
        renderDropdown();
        await userEvent.click(trigger());
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(menu()).not.toBeVisible();
        expect(document.activeElement).toBe(trigger());
    });

    it('an outside mousedown closes the menu', async () => {
        renderDropdown();
        await userEvent.click(trigger());
        fireEvent.mouseDown(document.body);
        expect(menu()).not.toBeVisible();
    });

    it('a mousedown inside a role="dialog" does not close it', async () => {
        renderDropdown();
        await userEvent.click(trigger());
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        document.body.appendChild(dialog);
        fireEvent.mouseDown(dialog);
        expect(menu()).toBeVisible();
        dialog.remove();
    });

    it('Cancel Poll closes the menu AND opens the confirm modal', async () => {
        renderDropdown();
        await userEvent.click(trigger());
        await userEvent.click(within(menu()).getByRole('menuitem', { name: 'Cancel Poll' }));
        expect(menu()).not.toBeVisible();
        expect(screen.getByRole('heading', { name: /cancel poll\?/i })).toBeInTheDocument();
    });

    it('Add Participants closes the menu AND opens its modal', async () => {
        renderDropdown();
        await userEvent.click(trigger());
        await userEvent.click(
            within(menu()).getByRole('menuitem', { name: 'Add Participants' }),
        );
        expect(menu()).not.toBeVisible();
        expect(screen.getByTestId('add-poll-members-submit')).toBeInTheDocument();
    });

    it('Remind Voters shows its in-flight copy', async () => {
        remindPending = true;
        renderDropdown();
        await userEvent.click(trigger());
        expect(within(menu()).getByRole('menuitem', { name: 'Reminding…' })).toBeDisabled();
    });
});
