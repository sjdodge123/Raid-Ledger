/** ROK-1572 (1572-AC2, approved H4) — the poll confirm; Cancel must never start a poll. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLfgMember } from '../../test/lfg-factories';
import { LfgPollConfirm } from './LfgPollConfirm';

const MEMBERS = [
    createMockLfgMember({ userId: 1, displayName: 'Ana' }),
    createMockLfgMember({ userId: 2, displayName: 'Bo' }),
    createMockLfgMember({ userId: 3, displayName: 'Cy' }),
];

function setup(isPending = false) {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderWithProviders(
        <LfgPollConfirm isOpen members={MEMBERS} isPending={isPending} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    return { onCancel, onConfirm };
}

describe('LfgPollConfirm', () => {
    it('names every member the Discord card goes to', () => {
        setup();
        expect(screen.getByTestId('lfg-poll-confirm')).toHaveTextContent(
            'These 3 people get a Discord card and a vote on times. You land on the poll next.',
        );
        const rows = screen.getAllByTestId('lfg-poll-confirm-member');
        expect(rows).toHaveLength(3);
        ['Ana', 'Bo', 'Cy'].forEach((name, i) => expect(rows[i]).toHaveTextContent(name));
    });

    it('Cancel calls onCancel and never onConfirm', async () => {
        const { onCancel, onConfirm } = setup();
        await userEvent.click(screen.getByTestId('lfg-poll-confirm-cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('Start poll calls onConfirm', async () => {
        const { onCancel, onConfirm } = setup();
        const submit = screen.getByTestId('lfg-poll-confirm-submit');
        expect(submit).toHaveTextContent('Start poll');
        await userEvent.click(submit);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('disables Start poll while the poll is being created', () => {
        setup(true);
        expect(screen.getByTestId('lfg-poll-confirm-submit')).toBeDisabled();
    });

    it('renders nothing while closed', () => {
        renderWithProviders(<LfgPollConfirm isOpen={false} members={MEMBERS} onCancel={vi.fn()} onConfirm={vi.fn()} />);
        expect(screen.queryByTestId('lfg-poll-confirm')).not.toBeInTheDocument();
    });
});
