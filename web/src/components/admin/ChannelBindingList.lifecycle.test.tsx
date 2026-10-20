/**
 * ROK-1428 (L7, W7) — the bindings list's lifecycle cell: auto-managed rows
 * get a state chip + Managed badge + Pin toggle; manual rows render nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChannelBindingDto } from '@raid-ledger/contract';
import { at } from '../../test/defined';
import { ChannelBindingList } from './ChannelBindingList';

function binding(overrides: Partial<ChannelBindingDto>): ChannelBindingDto {
    return {
        id: 'b1', guildId: 'g', channelId: 'c1', channelName: 'baldurs-gate-3', channelType: 'text',
        bindingPurpose: 'game-announcements', gameId: 1, gameName: 'BG3', config: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
    };
}

const AUTO = binding({ id: 'auto', lifecycleState: 'archived', autoManaged: true, pinned: false, archivedAt: '2026-10-01T00:00:00Z' });
const MANUAL = binding({ id: 'manual', channelId: 'c2', channelName: 'general' });

function renderList(onUpdate = vi.fn(), isUpdating = false) {
    render(<ChannelBindingList bindings={[AUTO, MANUAL]} onUpdate={onUpdate} onDelete={vi.fn()} isUpdating={isUpdating} isDeleting={false} />);
    const rows = screen.getAllByTestId('channel-binding-row');
    return { auto: at(rows, 0), manual: at(rows, 1), onUpdate };
}

describe('ChannelBindingList lifecycle cell (ROK-1433 W7)', () => {
    it('shows the cell on the auto row only', () => {
        const { auto, manual } = renderList();
        expect(within(auto).getByTestId('binding-lifecycle-cell')).toBeInTheDocument();
        expect(within(auto).getByText(/^Archived/)).toHaveAttribute('data-tone', 'neutral');
        expect(within(auto).getByText('Managed')).toBeInTheDocument();
        expect(within(manual).queryByTestId('binding-lifecycle-cell')).not.toBeInTheDocument();
        expect(within(manual).queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument();
    });

    it('Pin calls onUpdate with {pinned:true}', async () => {
        const { auto, onUpdate } = renderList();
        await userEvent.click(within(auto).getByRole('button', { name: 'Pin' }));
        expect(onUpdate).toHaveBeenCalledWith('auto', { pinned: true });
    });

    it('the toggle is disabled while a PATCH is pending', () => {
        const { auto } = renderList(vi.fn(), true);
        expect(within(auto).getByRole('button', { name: 'Pin' })).toBeDisabled();
    });
});
