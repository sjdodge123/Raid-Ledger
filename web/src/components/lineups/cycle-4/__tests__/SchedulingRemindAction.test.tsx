/**
 * SchedulingRemindAction tests (ROK-1395).
 * Covers the creator/operator visibility gate (via the real
 * canBypassThreshold), the read-only hide, the mutate payload, and the
 * pending/success disabled states.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingRemindAction } from '../SchedulingRemindAction';

const remindMutate = vi.fn();
let isPending = false;
let isSuccess = false;
vi.mock('../../../../hooks/use-scheduling', () => ({
    useRemindVoters: () => ({ mutate: remindMutate, isPending, isSuccess }),
}));

let authedUser: { id: number; role: string } | null = {
    id: 10,
    role: 'member',
};
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: authedUser }),
}));

const match = { lineupCreatedById: 10 } as MatchDetailResponseDto;

function renderAction(readOnly = false) {
    return renderWithProviders(
        <SchedulingRemindAction
            lineupId={5}
            matchId={9}
            match={match}
            readOnly={readOnly}
        />,
    );
}

describe('SchedulingRemindAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isPending = false;
        isSuccess = false;
        authedUser = { id: 10, role: 'member' };
    });

    it('renders nothing for a plain member who is not the creator', () => {
        authedUser = { id: 99, role: 'member' };
        const { container } = renderAction();
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing in read-only mode even for the creator', () => {
        const { container } = renderAction(true);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders for the lineup creator (member role)', () => {
        renderAction();
        expect(
            screen.getByRole('button', { name: /Remind Voters/i }),
        ).toBeEnabled();
    });

    it('renders for an operator who is not the creator', () => {
        authedUser = { id: 99, role: 'operator' };
        renderAction();
        expect(
            screen.getByRole('button', { name: /Remind Voters/i }),
        ).toBeInTheDocument();
    });

    it('clicking mutates with the lineup + match ids', async () => {
        const user = userEvent.setup();
        renderAction();
        await user.click(
            screen.getByRole('button', { name: /Remind Voters/i }),
        );
        expect(remindMutate).toHaveBeenCalledWith({ lineupId: 5, matchId: 9 });
    });

    it('disables with progress copy while pending', () => {
        isPending = true;
        renderAction();
        expect(
            screen.getByRole('button', { name: /Reminding…/i }),
        ).toBeDisabled();
    });

    it('stays disabled with "Reminded ✓" after success (cooldown armed)', () => {
        isSuccess = true;
        renderAction();
        expect(
            screen.getByRole('button', { name: /Reminded ✓/i }),
        ).toBeDisabled();
    });
});
