/**
 * ChannelBindingList — save outcomes through the REAL BindingConfigForm
 * (the sibling ChannelBindingList.test.tsx stubs the form out).
 * TDB:259 (stale shared update error) + TDB:260 (ROK-1416 AC8 reject/success).
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChannelBindingDto, UpdateChannelBindingDto } from '@raid-ledger/contract';
import { ChannelBindingList } from './ChannelBindingList';

// General Lobby bindings never render the game picker; mocked so no fetch can leak.
vi.mock('../../hooks/use-game-search', () => ({
  useGameSearch: () => ({ data: undefined, isLoading: false }),
}));

function lobby(id: string, channelName: string): ChannelBindingDto {
  return {
    id, guildId: 'guild-1', channelId: `ch-${id}`, channelName, channelType: 'voice',
    bindingPurpose: 'general-lobby', gameId: null, config: null,
    createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
  };
}

const CONFLICT = 'That channel already has a General Lobby binding.';
type UpdateFn = (id: string, dto: UpdateChannelBindingDto) => Promise<unknown>;

/**
 * Mirrors discord-channels-page: ONE update error shared by every row, set by
 * a rejected PATCH and cleared (`updateBinding.reset()`) on `onEditingChange`.
 */
function PageLikeHarness({ onUpdate }: { onUpdate: UpdateFn }) {
  const [updateError, setUpdateError] = useState<string | null>(null);
  const handleUpdate: UpdateFn = (id, dto) =>
    onUpdate(id, dto).catch((err: Error) => { setUpdateError(err.message); throw err; });
  return (
    <ChannelBindingList bindings={[lobby('a', 'lobby-a'), lobby('b', 'lobby-b')]}
      onUpdate={handleUpdate} onDelete={vi.fn()} isUpdating={false} isDeleting={false}
      updateError={updateError} onEditingChange={() => setUpdateError(null)} />
  );
}

function rows() {
  const [rowA, rowB] = screen.getAllByTestId('channel-binding-row');
  return { rowA, rowB };
}

/** Opens row A's editor and saves it; resolves once the save outcome has rendered. */
async function openAndSaveRowA(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(rows().rowA).getByRole('button', { name: 'Edit' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

describe('ChannelBindingList — AC8 save outcomes at list level (TDB:260)', () => {
  it('keeps the form open and shows the error when the save is rejected', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<UpdateFn>().mockRejectedValue(new Error(CONFLICT));
    render(<PageLikeHarness onUpdate={onUpdate} />);

    await openAndSaveRowA(user);

    expect(onUpdate).toHaveBeenCalledWith('a', expect.objectContaining({ config: expect.any(Object) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CONFLICT);
    expect(screen.getByText('Edit Config: #lobby-a')).toBeInTheDocument();
    expect(within(rows().rowA).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('closes the form once the save resolves', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<UpdateFn>().mockResolvedValue({ data: lobby('a', 'lobby-a') });
    render(<PageLikeHarness onUpdate={onUpdate} />);

    await openAndSaveRowA(user);

    await waitFor(() => expect(screen.queryByText('Edit Config: #lobby-a')).not.toBeInTheDocument());
    expect(within(rows().rowA).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ChannelBindingList — a failed save does not follow the admin to another row (TDB:259)', () => {
  it('row A save fails → close → open row B: row B shows no error banner', async () => {
    const user = userEvent.setup();
    render(<PageLikeHarness onUpdate={() => Promise.reject(new Error(CONFLICT))} />);
    await openAndSaveRowA(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(CONFLICT);

    await user.click(within(rows().rowA).getByRole('button', { name: 'Close' }));
    await user.click(within(rows().rowB).getByRole('button', { name: 'Edit' }));

    expect(screen.getByText('Edit Config: #lobby-b')).toBeInTheDocument();
    expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
  });

  it('row A save fails → Edit on row B directly: row B shows no error banner', async () => {
    const user = userEvent.setup();
    render(<PageLikeHarness onUpdate={() => Promise.reject(new Error(CONFLICT))} />);
    await openAndSaveRowA(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(CONFLICT);

    await user.click(within(rows().rowB).getByRole('button', { name: 'Edit' }));

    expect(screen.getByText('Edit Config: #lobby-b')).toBeInTheDocument();
    expect(screen.queryByText(CONFLICT)).not.toBeInTheDocument();
  });
});
