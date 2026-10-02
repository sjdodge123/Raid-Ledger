/**
 * TDB:259 — the page's single `updateBinding` mutation error is shared by every
 * binding row, so opening/closing a row editor must reset it. Hooks are mocked
 * so the assertion pins the page → list → `updateBinding.reset()` wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from '@tanstack/react-query';
import type { ChannelBindingDto, UpdateChannelBindingDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { useChannelBindings } from '../../hooks/use-channel-bindings';
import { DiscordChannelsPage } from './discord-channels-page';
import { at } from '../../test/defined';

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
    const rowB = at(screen.getAllByTestId('channel-binding-row'), 1);

    await user.click(within(rowB).getByRole('button', { name: 'Edit' }));
    expect(resetUpdate).toHaveBeenCalledTimes(1);

    await user.click(within(rowB).getByRole('button', { name: 'Close' }));
    expect(resetUpdate).toHaveBeenCalledTimes(2);
  });
});

/** A real TanStack mutation whose PATCH the test settles by hand; `reset` is spied on. */
let pendingSave: { promise: Promise<{ data: ChannelBindingDto }>; reject: (e: Error) => void };
const realReset = vi.fn();

function useBindingsWithRealUpdate() {
  const updateBinding = useMutation<{ data: ChannelBindingDto }, Error, { id: string; dto: UpdateChannelBindingDto }>({
    mutationFn: () => pendingSave.promise,
  });
  return {
    bindings: { isLoading: false, isError: false, data: { data: [lobby('a'), lobby('b')] } },
    updateBinding: { ...updateBinding, reset: () => { realReset(); updateBinding.reset(); } },
    createBinding: mutation(),
    deleteBinding: mutation(),
  } as unknown as ReturnType<typeof useChannelBindings>;
}

describe('DiscordChannelsPage — switching rows never detaches an in-flight save', () => {
  it('row A save pending → Edit row B → back to A: no reset, A still saving, its rejection shows in A', async () => {
    let reject!: (e: Error) => void;
    const promise = new Promise<{ data: ChannelBindingDto }>((_res, rej) => { reject = rej; });
    pendingSave = { promise, reject };
    realReset.mockReset();
    vi.mocked(useChannelBindings).mockImplementation(useBindingsWithRealUpdate);
    const user = userEvent.setup();
    renderWithProviders(<DiscordChannelsPage />);
    const row = (i: number) => at(screen.getAllByTestId('channel-binding-row'), i);

    await user.click(within(row(0)).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Saving...' })).toHaveAttribute('aria-busy', 'true');
    realReset.mockClear();

    await user.click(within(row(1)).getByRole('button', { name: 'Edit' }));
    expect(realReset).not.toHaveBeenCalled();

    await user.click(within(row(0)).getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Edit Config: #lobby-a')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saving...' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => { pendingSave.reject(new Error('Row A save was rejected')); await promise.catch(() => {}); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Row A save was rejected');
    expect(realReset).not.toHaveBeenCalled();
  });
});
