/**
 * ROK-2033 AC8 — the admin "Reopen lock-in" banner. Visible only when the
 * server flagged the poll `lockInRecoverable` AND the viewer is an admin;
 * the banner button opens a confirm (no mutate), confirm fires the mutation
 * for this match, and the confirm cannot be dismissed while it is pending.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test/render-helpers';
import {
    SchedulingReopenLockInAction,
    REOPEN_BANNER_COPY,
    REOPEN_CONFIRM_COPY,
} from '../SchedulingReopenLockInAction';

const reopenMutate = vi.fn();
let isPending = false;
vi.mock('../../../../hooks/use-scheduling', () => ({
    useReopenLockIn: () => ({ mutate: reopenMutate, isPending }),
}));

let authedUser: { role: string } | null = { role: 'admin' };
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: authedUser }),
    isAdmin: (u: { role: string } | null) => u?.role === 'admin',
}));

vi.mock('../../../../hooks/use-media-query', () => ({
    useMediaQuery: () => true,
}));

function renderAction(recoverable: boolean | undefined = true) {
    return renderWithProviders(
        <SchedulingReopenLockInAction matchId={9} recoverable={recoverable} />,
    );
}

describe('SchedulingReopenLockInAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isPending = false;
        authedUser = { role: 'admin' };
    });

    it('renders nothing when the poll is not flagged recoverable', () => {
        const { container } = renderAction(undefined);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when the flag is false', () => {
        const { container } = renderAction(false);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for a non-admin even with the flag set', () => {
        authedUser = { role: 'operator' };
        const { container } = renderAction(true);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the banner and the Reopen lock-in button for an admin', () => {
        renderAction(true);
        expect(screen.getByText(REOPEN_BANNER_COPY)).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Reopen lock-in' }),
        ).toBeInTheDocument();
    });

    it('the banner button opens the confirm and does NOT mutate', async () => {
        const user = userEvent.setup();
        renderAction(true);
        await user.click(screen.getByRole('button', { name: 'Reopen lock-in' }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(REOPEN_CONFIRM_COPY)).toBeInTheDocument();
        expect(reopenMutate).not.toHaveBeenCalled();
    });

    it('Cancel closes the confirm without mutating', async () => {
        const user = userEvent.setup();
        renderAction(true);
        await user.click(screen.getByRole('button', { name: 'Reopen lock-in' }));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(reopenMutate).not.toHaveBeenCalled();
    });

    it('confirming fires the mutation for this match', async () => {
        const user = userEvent.setup();
        renderAction(true);
        await user.click(screen.getByRole('button', { name: 'Reopen lock-in' }));
        await user.click(screen.getByRole('button', { name: 'Reopen poll' }));
        expect(reopenMutate).toHaveBeenCalledTimes(1);
        expect(reopenMutate.mock.calls[0]?.[0]).toEqual({ matchId: 9 });
    });

    it('the confirm stays open while the request is pending', async () => {
        const user = userEvent.setup();
        const { rerender } = renderAction(true);
        await user.click(screen.getByRole('button', { name: 'Reopen lock-in' }));
        isPending = true;
        rerender(<SchedulingReopenLockInAction matchId={9} recoverable={true} />);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
});
