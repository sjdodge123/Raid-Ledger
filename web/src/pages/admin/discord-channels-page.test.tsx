/**
 * TDB:259 — the page's single `updateBinding` mutation error is shared by every
 * binding row, so opening/closing a row editor must reset it. Hooks are mocked
 * so the assertion pins the page → list → `updateBinding.reset()` wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChannelBindingDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { useChannelBindings } from '../../hooks/use-channel-bindings';
import { DiscordChannelsPage } from './discord-channels-page';

vi.mock('../../hooks/use-channel-bindings', () => ({ useChannelBindings: vi.fn() }));
vi.mock('../../hooks/use-game-search', () => ({
  useGameSearch: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('../../stores/plugin-store', () => ({
  usePluginStore: (select: (s: { isPluginActive: () => boolean }) => unknown) =>
    select({ isPluginActive: () => true }),
}));
vi.mock('../../hooks/use-admin-settings', () => ({
  useAdminSettings: () => ({
    discordBotStatus: { data: { connected: false } },
    discordChannels: { data: [] },
    discordVoiceChannels: { data: [] },
  }),
}));

function lobby(id: string): ChannelBindingDto {
  return {
    id, guildId: 'guild-1', channelId: `ch-${id}`, channelName: `lobby-${id}`, channelType: 'voice',
    bindingPurpose: 'general-lobby', gameId: null, config: null,
    createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
  };
}

function mutation(extra: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null, reset: vi.fn(), ...extra };
}

const resetUpdate = vi.fn();

beforeEach(() => {
  resetUpdate.mockReset();
  vi.mocked(useChannelBindings).mockReturnValue({
    bindings: { isLoading: false, isError: false, data: { data: [lobby('a'), lobby('b')] } },
    updateBinding: mutation({ error: new Error('Row A save was rejected'), reset: resetUpdate }),
    createBinding: mutation(),
    deleteBinding: mutation(),
  } as unknown as ReturnType<typeof useChannelBindings>);
});

describe('DiscordChannelsPage — binding row editor resets the update error (TDB:259)', () => {
  it('resets the update mutation when a row editor opens and again when it closes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DiscordChannelsPage />);
    const rowB = screen.getAllByTestId('channel-binding-row')[1];

    await user.click(within(rowB).getByRole('button', { name: 'Edit' }));
    expect(resetUpdate).toHaveBeenCalledTimes(1);

    await user.click(within(rowB).getByRole('button', { name: 'Close' }));
    expect(resetUpdate).toHaveBeenCalledTimes(2);
  });
});
