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
        expect(within(auto).getByText(/^Archived [A-Z][a-z]{2} \d{1,2}$/)).toHaveAttribute('data-tone', 'neutral');
        expect(within(auto).getByText('Managed')).toBeInTheDocument();
        expect(within(manual).queryByTestId('binding-lifecycle-cell')).not.toBeInTheDocument();
        expect(within(manual).queryByRole('button', { name: 'Pin #baldurs-gate-3' })).not.toBeInTheDocument();
    });

    it('Pin calls onUpdate with {pinned:true}', async () => {
        const { auto, onUpdate } = renderList();
        await userEvent.click(within(auto).getByRole('button', { name: 'Pin #baldurs-gate-3' }));
        expect(onUpdate).toHaveBeenCalledWith('auto', { pinned: true });
    });

    it('the toggle is disabled while a PATCH is pending', () => {
        const { auto } = renderList(vi.fn(), true);
        expect(within(auto).getByRole('button', { name: 'Pin #baldurs-gate-3' })).toBeDisabled();
    });

    it('a rejected pin PATCH is consumed, never an unhandled rejection (Codex r5)', async () => {
        // Rejected lazily (inside the call) so only the handler can be the one to catch it;
        // a plain function, not vi.fn(): vi.fn attaches its own `then` to track settled results.
        const calls: unknown[] = [];
        const thenSpies: Array<ReturnType<typeof vi.fn>> = [];
        const onUpdate = (...args: unknown[]) => {
            calls.push(args);
            const rejected = Promise.reject(new Error('Pin refused'));
            const spy = vi.fn(rejected.then.bind(rejected));
            thenSpies.push(spy);
            return Object.assign(rejected, { then: spy });
        };
        render(<ChannelBindingList bindings={[AUTO]} onUpdate={onUpdate} onDelete={vi.fn()} isUpdating={false} isDeleting={false} />);
        await userEvent.click(screen.getByRole('button', { name: 'Pin #baldurs-gate-3' }));
        expect(calls).toEqual([['auto', { pinned: true }]]);
        expect(thenSpies.length).toBe(1);
        expect(at(thenSpies, 0), 'the pin handler must attach a rejection handler').toHaveBeenCalled();
    });

    it('a pin shows pending + its error on THAT row only', async () => {
        const AUTO2 = binding({ id: 'auto2', channelId: 'c3', channelName: 'elden-ring', lifecycleState: 'active', autoManaged: true, pinned: false });
        const onUpdate = vi.fn(() => new Promise<unknown>(() => {}));
        const props = { onUpdate, onDelete: vi.fn(), isDeleting: false };
        const { rerender } = render(<ChannelBindingList bindings={[AUTO, AUTO2]} isUpdating={false} {...props} />);
        const rows = (): HTMLElement[] => screen.getAllByTestId('channel-binding-row');
        await userEvent.click(within(at(rows(), 1)).getByRole('button', { name: 'Pin #elden-ring' }));
        rerender(<ChannelBindingList bindings={[AUTO, AUTO2]} isUpdating updateError="Pin refused" {...props} />);
        expect(within(at(rows(), 1)).getByRole('button', { name: 'Pin #elden-ring' })).toHaveAttribute('aria-busy', 'true');
        expect(within(at(rows(), 0)).getByRole('button', { name: 'Pin #baldurs-gate-3' })).not.toHaveAttribute('aria-busy');
        expect(within(at(rows(), 1)).getByText('Pin refused')).toBeInTheDocument();
        expect(screen.getAllByText('Pin refused')).toHaveLength(1);
    });
});
