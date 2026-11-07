/**
 * ROK-2106 — the bindings list renders one card per Discord channel: a
 * channel's bindings sit together, and its lifecycle chips + multi-monitor
 * notice render once per channel, not once per binding.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ChannelBindingDto } from '@raid-ledger/contract';
import { at } from '../../test/defined';
import { ChannelBindingList } from './ChannelBindingList';

function b(overrides: Partial<ChannelBindingDto>): ChannelBindingDto {
    return {
        id: 'b', guildId: 'g', channelId: 'wow-t', channelName: 'wow', channelType: 'text',
        bindingPurpose: 'game-announcements', gameId: 1, gameName: 'WoW: Forever', config: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
    };
}

const AUTO = { autoManaged: true, lifecycleState: 'active', pinned: false } as const;
const WOW_F = b({ id: 'wow-f', ...AUTO });
const GENERAL = b({ id: 'gen', channelId: 'gen-t', channelName: 'general', bindingPurpose: 'general-lobby', gameId: null, gameName: undefined });
const WOW_B = b({ id: 'wow-b', gameId: 2, gameName: 'BCC Anniversary', ...AUTO });
const VOICE = { channelId: 'wow-v', channelName: 'WoW', channelType: 'voice', bindingPurpose: 'game-voice-monitor' } as const;
const WV_F = b({ id: 'wv-f', ...VOICE });
const WV_B = b({ id: 'wv-b', ...VOICE, gameId: 2, gameName: 'BCC Anniversary' });

function renderList(bindings: ChannelBindingDto[]): HTMLElement[] {
    render(<ChannelBindingList bindings={bindings} onUpdate={vi.fn()} onDelete={vi.fn()} isUpdating={false} isDeleting={false} />);
    return screen.getAllByTestId('channel-binding-group');
}

describe('ChannelBindingList grouped by channel (ROK-2106)', () => {
    it('puts a channel\'s scattered bindings in one group, adjacent, ordered by channel name', () => {
        const groups = renderList([WOW_F, GENERAL, WOW_B]);
        expect(groups.map((g) => within(g).getByTestId('channel-binding-group-name').textContent)).toEqual(['#general', '#wow']);
        const wowRows = within(at(groups, 1)).getAllByTestId('channel-binding-row');
        expect(wowRows.map((r) => r.textContent)).toEqual([
            expect.stringContaining('WoW: Forever'), expect.stringContaining('BCC Anniversary'),
        ]);
        expect(within(at(groups, 1)).getByLabelText('2 bindings')).toHaveTextContent('2');
        expect(within(at(groups, 0)).getAllByTestId('channel-binding-row')).toHaveLength(1);
    });

    it('renders the channel lifecycle chips and Pin toggle once per channel', () => {
        const groups = renderList([WOW_F, WOW_B]);
        expect(groups).toHaveLength(1);
        expect(screen.getAllByTestId('binding-lifecycle-cell')).toHaveLength(1);
        expect(screen.getAllByText('Managed')).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Pin #wow' })).toHaveLength(1);
        for (const row of screen.getAllByTestId('channel-binding-row')) {
            expect(within(row).queryByTestId('binding-lifecycle-cell')).not.toBeInTheDocument();
        }
    });

    it('splits a text and a voice channel of the same name and shows the multi-monitor notice once', () => {
        const groups = renderList([WV_F, WOW_F, WV_B]);
        expect(groups).toHaveLength(2);
        expect(screen.getAllByText(/Heads up: this channel monitors more than one game/)).toHaveLength(1);
        expect(within(at(groups, 1)).getByText(/Heads up/)).toBeInTheDocument();
        expect(within(at(groups, 1)).getAllByTestId('channel-binding-row')).toHaveLength(2);
        expect(within(at(groups, 0)).getAllByTestId('channel-binding-row')).toHaveLength(1);
    });

    it('keeps per-binding Edit and Remove on every row', () => {
        renderList([WOW_F, WOW_B]);
        for (const row of screen.getAllByTestId('channel-binding-row')) {
            expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
            expect(within(row).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
        }
    });
});
