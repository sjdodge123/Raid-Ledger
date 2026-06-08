/**
 * SchedulingCancelAction + CancelPollModal tests (ROK-1219 / F-38).
 * Covers the second-confirm flow: button opens a modal (no mutate), the
 * modal's own Cancel closes it (no mutate), confirm passes the trimmed reason
 * (or null) and navigates on success.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingCancelAction } from '../SchedulingCancelAction';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual =
        await vi.importActual<typeof import('react-router-dom')>(
            'react-router-dom',
        );
    return { ...actual, useNavigate: () => navigate };
});

const cancelMutate = vi.fn();
let isPending = false;
vi.mock('../../../../hooks/use-scheduling', () => ({
    useCancelSchedulePoll: () => ({ mutate: cancelMutate, isPending }),
}));

let authedUser: { role: string } | null = { role: 'operator' };
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: authedUser }),
    isOperatorOrAdmin: (u: { role: string } | null) =>
        u?.role === 'operator' || u?.role === 'admin',
}));

const CANCEL_COPY =
    'Cancel this poll? Voters will be notified. This cannot be undone.';

function renderAction() {
    return renderWithProviders(
        <SchedulingCancelAction lineupId={5} matchId={9} readOnly={false} />,
    );
}

describe('SchedulingCancelAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isPending = false;
        authedUser = { role: 'operator' };
    });

    it('renders nothing for a non-operator', () => {
        authedUser = { role: 'member' };
        const { container } = renderAction();
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing in read-only mode', () => {
        const { container } = renderWithProviders(
            <SchedulingCancelAction
                lineupId={5}
                matchId={9}
                readOnly={true}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('clicking Cancel Poll opens the modal and does NOT mutate', async () => {
        const user = userEvent.setup();
        renderAction();
        await user.click(
            screen.getByRole('button', { name: /Cancel Poll/i }),
        );
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(CANCEL_COPY)).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toBeInTheDocument();
        expect(cancelMutate).not.toHaveBeenCalled();
    });

    it('modal Cancel closes without mutating', async () => {
        const user = userEvent.setup();
        renderAction();
        await user.click(
            screen.getByRole('button', { name: /Cancel Poll/i }),
        );
        const dialog = screen.getByRole('dialog');
        await user.click(
            within(dialog).getByRole('button', { name: /^Cancel$/ }),
        );
        await waitFor(() =>
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
        );
        expect(cancelMutate).not.toHaveBeenCalled();
    });

    it('confirm with a reason mutates with the trimmed reason', async () => {
        const user = userEvent.setup();
        renderAction();
        await user.click(
            screen.getByRole('button', { name: /Cancel Poll/i }),
        );
        await user.type(screen.getByRole('textbox'), '  too few players  ');
        const dialog = screen.getByRole('dialog');
        await user.click(
            within(dialog)
                .getAllByRole('button', { name: /Cancel Poll/i })
                .at(-1)!,
        );
        expect(cancelMutate).toHaveBeenCalledWith(
            { lineupId: 5, matchId: 9, reason: 'too few players' },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
    });

    it('confirm with no reason mutates with null', async () => {
        const user = userEvent.setup();
        renderAction();
        await user.click(
            screen.getByRole('button', { name: /Cancel Poll/i }),
        );
        const dialog = screen.getByRole('dialog');
        await user.click(
            within(dialog)
                .getAllByRole('button', { name: /Cancel Poll/i })
                .at(-1)!,
        );
        expect(cancelMutate).toHaveBeenCalledWith(
            { lineupId: 5, matchId: 9, reason: null },
            expect.anything(),
        );
    });

    it('navigates to /events on successful cancel', async () => {
        const user = userEvent.setup();
        cancelMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
        renderAction();
        await user.click(
            screen.getByRole('button', { name: /Cancel Poll/i }),
        );
        const dialog = screen.getByRole('dialog');
        await user.click(
            within(dialog)
                .getAllByRole('button', { name: /Cancel Poll/i })
                .at(-1)!,
        );
        expect(navigate).toHaveBeenCalledWith('/events');
    });
});
