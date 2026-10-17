/**
 * SessionLengthForm (ROK-1653 G3b): the days input is a Field-labelled
 * spinbutton whose hint is its description, and Save is the shared Button
 * (aria-busy while the mutation is pending, ruling 7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionLengthForm } from './SessionLengthForm';

const mocks = vi.hoisted(() => ({
    sessionLength: { isLoading: false, data: { sessionLengthDays: 60 } },
    updateSessionLength: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('../../hooks/admin/use-session-length', () => ({
    useSessionLength: () => mocks,
}));

vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSessionLength.isPending = false;
    mocks.updateSessionLength.mutateAsync.mockResolvedValue(undefined);
});

describe('SessionLengthForm — field', () => {
    it('"Session length (days)" is a 1–365 spinbutton described by its hint', () => {
        render(<SessionLengthForm />);
        const input = screen.getByLabelText('Session length (days)');
        expect(input).toBe(screen.getByRole('spinbutton', { name: 'Session length (days)' }));
        expect(input).toHaveValue(60);
        expect(input).toHaveAttribute('min', '1');
        expect(input).toHaveAttribute('max', '365');
        expect(input).toHaveAccessibleDescription(/stays valid before re-login \(default 60\)/);
    });

    it('saves the edited number of days', async () => {
        const user = userEvent.setup();
        render(<SessionLengthForm />);
        const input = screen.getByRole('spinbutton', { name: 'Session length (days)' });
        await user.clear(input);
        await user.type(input, '30');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(mocks.updateSessionLength.mutateAsync).toHaveBeenCalledWith(30);
    });
});

describe('SessionLengthForm — Save', () => {
    it('is aria-busy + aria-disabled while pending and a click does not submit', async () => {
        mocks.updateSessionLength.isPending = true;
        const user = userEvent.setup();
        render(<SessionLengthForm />);
        const save = screen.getByRole('button', { name: 'Saving…' });
        expect(save).toHaveAttribute('aria-busy', 'true');
        expect(save).toHaveAttribute('aria-disabled', 'true');
        await user.click(save);
        expect(mocks.updateSessionLength.mutateAsync).not.toHaveBeenCalled();
    });
});
