/** ROK-1573 (approved H3) — the Lock-in confirm names the range and the window's members. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgMember, createMockOverlapWindow } from '../../test/lfg-factories';
import { LfgLockInConfirm } from './LfgLockInConfirm';

const MEMBERS = [
    createMockLfgMember({ userId: 1, displayName: 'Ana' }),
    createMockLfgMember({ userId: 2, displayName: 'Bo' }),
    createMockLfgMember({ userId: 3, displayName: 'Cy' }),
];
// Wed 2 Sep 2026, 7–10 PM local; only Ana and Cy are free.
const WINDOW = createMockOverlapWindow({
    start: new Date(2026, 8, 2, 19).toISOString(),
    end: new Date(2026, 8, 2, 22).toISOString(),
    members: [1, 3],
});

function setup(isPending = false) {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderWithProviders(
        <LfgLockInConfirm isOpen window={WINDOW} members={MEMBERS} isPending={isPending} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    return { onCancel, onConfirm };
}

describe('LfgLockInConfirm', () => {
    it('reads the range and only the members free in the window', () => {
        setup();
        expect(screen.getByText('Lock in this event?')).toBeInTheDocument();
        const body = screen.getByTestId('lfg-lockin-confirm');
        expect(body).toHaveTextContent('Wed 7–10 PM · these 2 get signed up and a Discord card.');
        expect(body).toHaveTextContent('Ana');
        expect(body).toHaveTextContent('Cy');
        expect(body).not.toHaveTextContent('Bo');
    });

    it('Cancel calls onCancel and never onConfirm', async () => {
        const { onCancel, onConfirm } = setup();
        await userEvent.click(screen.getByTestId('lfg-lockin-confirm-cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('Lock in calls onConfirm', async () => {
        const { onConfirm } = setup();
        const submit = screen.getByTestId('lfg-lockin-confirm-submit');
        expect(submit).toHaveTextContent('Lock in');
        await userEvent.click(submit);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('disables Lock in while the event is being created', () => {
        setup(true);
        expect(screen.getByTestId('lfg-lockin-confirm-submit')).toBeDisabled();
    });
});
