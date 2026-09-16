/**
 * ROK-1584 (H1-b) — the phone "Manage poll ⋯" row and its sheet.
 *
 * Below the phone breakpoint the hero's three creator/operator buttons become
 * ONE full-width row in the hero's `manage` slot, opening a bottom sheet with
 * the same three actions as 52px rows. The rows must keep the SAME accessible
 * names the desktop buttons carry ("Add Participants" / "Remind Voters" /
 * "Cancel Poll") — `scheduling-poll.smoke.spec.ts` queries them by role name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import {
    SchedulingManageButton,
    pendingVoterCount,
} from '../SchedulingManageSheet';
import {
    SCHEDULING_MANAGE_BUTTON,
    SCHEDULING_SHEET_ROW_BASE,
} from '../scheduling-action-button';

vi.mock('react-router-dom', async () => {
    const actual =
        await vi.importActual<typeof import('react-router-dom')>(
            'react-router-dom',
        );
    return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../../../hooks/use-scheduling', () => ({
    useAddPollMembers: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRemindVoters: () => ({
        mutate: vi.fn(),
        isPending: false,
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

function renderManage(readOnly = false): void {
    renderWithProviders(
        <SchedulingManageButton
            lineupId={5}
            matchId={9}
            match={match}
            readOnly={readOnly}
            uniqueVoterCount={3}
        />,
    );
}

describe('SchedulingManageButton (ROK-1584)', () => {
    beforeEach(() => {
        viewer = { id: 10, role: 'operator' };
    });

    it('draws a full-width 44px row for a creator/operator', () => {
        renderManage();
        const btn = screen.getByTestId('scheduling-manage');
        expect(btn).toHaveTextContent('Manage poll');
        for (const cls of SCHEDULING_MANAGE_BUTTON.split(/\s+/).filter(Boolean)) {
            expect(Array.from(btn.classList)).toContain(cls);
        }
        expect(SCHEDULING_MANAGE_BUTTON).toContain('min-h-[44px]');
        expect(SCHEDULING_MANAGE_BUTTON).toContain('w-full');
    });

    it('renders nothing for a plain member', () => {
        viewer = { id: 99, role: 'member' };
        renderManage();
        expect(screen.queryByTestId('scheduling-manage')).toBeNull();
    });

    it('renders nothing in a read-only poll', () => {
        renderManage(true);
        expect(screen.queryByTestId('scheduling-manage')).toBeNull();
    });

    it('mounts no sheet until the row is tapped', () => {
        renderManage();
        expect(screen.queryByTestId('scheduling-manage-sheet')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cancel Poll' })).toBeNull();
    });

    it('opens a "Manage poll" sheet with the three action rows', async () => {
        renderManage();
        await userEvent.click(screen.getByTestId('scheduling-manage'));

        expect(screen.getByRole('dialog', { name: 'Manage poll' })).toBeInTheDocument();
        expect(screen.getByTestId('scheduling-manage-title')).toHaveTextContent(
            'Manage poll',
        );
        const rows = [
            screen.getByRole('button', { name: 'Add Participants' }),
            screen.getByRole('button', { name: 'Remind Voters' }),
            screen.getByRole('button', { name: 'Cancel Poll' }),
        ];
        for (const row of rows) {
            for (const cls of SCHEDULING_SHEET_ROW_BASE.split(/\s+/).filter(Boolean)) {
                expect(Array.from(row.classList)).toContain(cls);
            }
        }
        expect(SCHEDULING_SHEET_ROW_BASE).toContain('min-h-[52px]');
        expect(rows[2].className).toContain('text-red-400');
    });

    it('sublines the rows with the invite hint and the not-yet-voted count', async () => {
        renderManage();
        await userEvent.click(screen.getByTestId('scheduling-manage'));
        expect(
            screen.getByRole('button', { name: 'Add Participants' }),
        ).toHaveTextContent('invite more people');
        expect(
            screen.getByRole('button', { name: 'Remind Voters' }),
        ).toHaveTextContent("1 haven't voted");
    });

    it('opens the existing Add Participants modal from its row', async () => {
        renderManage();
        await userEvent.click(screen.getByTestId('scheduling-manage'));
        await userEvent.click(
            screen.getByRole('button', { name: 'Add Participants' }),
        );
        expect(screen.getByTestId('add-poll-members-submit')).toBeInTheDocument();
    });

    it('opens the existing Cancel Poll confirm modal from its row', async () => {
        renderManage();
        await userEvent.click(screen.getByTestId('scheduling-manage'));
        await userEvent.click(screen.getByRole('button', { name: 'Cancel Poll' }));
        expect(
            screen.getByRole('heading', { name: /cancel poll\?/i }),
        ).toBeInTheDocument();
    });
});

describe('pendingVoterCount', () => {
    it('is members minus voters, floored at zero', () => {
        expect(pendingVoterCount(match, 3)).toBe(1);
        expect(pendingVoterCount(match, 9)).toBe(0);
    });

    it('is undefined when the voter count is unknown', () => {
        expect(pendingVoterCount(match, undefined)).toBeUndefined();
    });
});
