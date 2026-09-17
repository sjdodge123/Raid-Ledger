/**
 * ROK-1573 (approved H3 + review rulings) — the Lock-in confirm names the
 * 3-hour-capped range and EVERY member (the whole group is signed up),
 * marking the ones not free in the window.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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
    it('reads the range and that all members in the group get signed up', () => {
        setup();
        expect(screen.getByText('Lock in this event?')).toBeInTheDocument();
        const body = screen.getByTestId('lfg-lockin-confirm');
        expect(body).toHaveTextContent('Wed 7–10 PM · all 3 in the group get signed up and a Discord card.');
    });

    it('lists every member and marks only the ones not free then', () => {
        setup();
        const rows = screen.getAllByTestId('lfg-lockin-member');
        expect(rows).toHaveLength(3);
        ['Ana', 'Bo', 'Cy'].forEach((name, i) => expect(rows[i]).toHaveTextContent(name));
        expect(within(rows[0]).queryByTestId('lfg-lockin-not-free')).toBeNull();
        expect(within(rows[1]).getByTestId('lfg-lockin-not-free')).toHaveTextContent('not free then');
        expect(within(rows[2]).queryByTestId('lfg-lockin-not-free')).toBeNull();
    });

    it('reads the event range capped at 3 hours for a longer window', () => {
        renderWithProviders(
            <LfgLockInConfirm
                isOpen
                window={createMockOverlapWindow({
                    start: new Date(2026, 8, 2, 15).toISOString(),
                    end: new Date(2026, 8, 2, 22).toISOString(),
                    members: [1, 2, 3],
                })}
                members={MEMBERS}
                onCancel={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );
        expect(screen.getByTestId('lfg-lockin-confirm')).toHaveTextContent('Wed 3–6 PM · all 3 in the group');
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
