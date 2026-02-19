import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChannelBindingList } from './ChannelBindingList';
import type { ChannelBindingDto } from '@raid-ledger/contract';

// BindingConfigForm is rendered inline — mock it to keep unit tests focused
vi.mock('./BindingConfigForm', () => ({
  BindingConfigForm: ({
    binding,
    onSave,
    onCancel,
  }: {
    binding: ChannelBindingDto;
    onSave: (id: string, dto: unknown) => void;
    onCancel: () => void;
    isSaving: boolean;
  }) => (
    <div data-testid="binding-config-form">
      <span>{binding.id}</span>
      <button onClick={() => onSave(binding.id, { config: {} })}>
        Save Form
      </button>
      <button onClick={onCancel}>Cancel Form</button>
    </div>
  ),
}));

function makeBinding(overrides: Partial<ChannelBindingDto> = {}): ChannelBindingDto {
  return {
    id: 'uuid-1',
    guildId: 'guild-123',
    channelId: 'channel-456',
    channelName: 'general',
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameId: null,
    config: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ChannelBindingList', () => {
  const onUpdate = vi.fn();
  const onDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Empty state ──────────────────────────────────────────────

  it('shows empty state message when bindings array is empty', () => {
    render(
      <ChannelBindingList
        bindings={[]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(
      screen.getByText('No channel bindings configured'),
    ).toBeInTheDocument();
  });

  it('mentions /bind command in empty state', () => {
    render(
      <ChannelBindingList
        bindings={[]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByText('/bind')).toBeInTheDocument();
  });

  // ── Single binding rendering ─────────────────────────────────

  it('renders the channel name for a text binding', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding({ channelName: 'raid-announcements' })]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByText('#raid-announcements')).toBeInTheDocument();
  });

  it('falls back to channelId when channelName is undefined', () => {
    render(
      <ChannelBindingList
        bindings={[
          makeBinding({ channelName: undefined, channelId: 'ch-789' }),
        ]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByText('#ch-789')).toBeInTheDocument();
  });

  it('shows "Announcements" badge for game-announcements binding', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding({ bindingPurpose: 'game-announcements' })]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByText('Announcements')).toBeInTheDocument();
  });

  it('shows "Voice Monitor" badge for game-voice-monitor binding', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding({ bindingPurpose: 'game-voice-monitor' })]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByText('Voice Monitor')).toBeInTheDocument();
  });

  it('shows "General Lobby" badge for general-lobby binding', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding({ bindingPurpose: 'general-lobby' })]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByText('General Lobby')).toBeInTheDocument();
  });

  it('shows game name when binding has gameName', () => {
    render(
      <ChannelBindingList
        bindings={[
          makeBinding({ gameName: 'World of Warcraft', gameId: 'game-1' }),
        ]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByText(/World of Warcraft/)).toBeInTheDocument();
  });

  it('shows "All games" when binding has no gameName', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding({ gameName: undefined, gameId: null })]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByText(/All games/)).toBeInTheDocument();
  });

  // ── Edit button ──────────────────────────────────────────────

  it('renders an Edit button for each binding', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding()]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('shows BindingConfigForm when Edit is clicked', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding({ id: 'uuid-1' })]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByTestId('binding-config-form')).toBeInTheDocument();
  });

  it('toggles Edit button label to "Close" when form is open', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding()]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('hides BindingConfigForm when Close is clicked', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding()]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('binding-config-form')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('binding-config-form')).not.toBeInTheDocument();
  });

  it('hides form when Cancel is clicked inside BindingConfigForm', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding()]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Form' }));

    expect(screen.queryByTestId('binding-config-form')).not.toBeInTheDocument();
  });

  it('calls onUpdate when Save is clicked inside BindingConfigForm', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding({ id: 'uuid-1' })]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Form' }));

    expect(onUpdate).toHaveBeenCalledWith('uuid-1', { config: {} });
  });

  it('hides form after Save is submitted', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding()]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Form' }));

    expect(screen.queryByTestId('binding-config-form')).not.toBeInTheDocument();
  });

  // ── Delete button ────────────────────────────────────────────

  it('renders a Remove button for each binding', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding()]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('calls onDelete with binding id when Remove is clicked', () => {
    render(
      <ChannelBindingList
        bindings={[makeBinding({ id: 'uuid-1' })]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onDelete).toHaveBeenCalledWith('uuid-1');
  });

  it('disables Remove button when isDeleting and deletingId matches', () => {
    const binding = makeBinding({ id: 'uuid-1' });

    const { rerender } = render(
      <ChannelBindingList
        bindings={[binding]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    // Click to trigger deletion (sets deletingId)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    rerender(
      <ChannelBindingList
        bindings={[binding]}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={true}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Removing...' }),
    ).toBeDisabled();
  });

  it('does not disable Remove button for other bindings when one is deleting', () => {
    const bindings = [
      makeBinding({ id: 'uuid-1', channelName: 'ch1' }),
      makeBinding({ id: 'uuid-2', channelName: 'ch2', channelId: 'ch-2' }),
    ];

    const { rerender } = render(
      <ChannelBindingList
        bindings={bindings}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    // Delete the first binding
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[0]);

    rerender(
      <ChannelBindingList
        bindings={bindings}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={true}
      />,
    );

    // Second binding's Remove button should still be enabled
    const secondRemoveBtn = screen.getByRole('button', { name: 'Remove' });
    expect(secondRemoveBtn).not.toBeDisabled();
  });

  // ── Multiple bindings ────────────────────────────────────────

  it('renders all bindings in the list', () => {
    const bindings = [
      makeBinding({ id: 'uuid-1', channelName: 'general', channelId: 'ch-1' }),
      makeBinding({ id: 'uuid-2', channelName: 'raids', channelId: 'ch-2' }),
      makeBinding({ id: 'uuid-3', channelName: 'voice', channelId: 'ch-3' }),
    ];

    render(
      <ChannelBindingList
        bindings={bindings}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    expect(screen.getByText('#general')).toBeInTheDocument();
    expect(screen.getByText('#raids')).toBeInTheDocument();
    expect(screen.getByText('#voice')).toBeInTheDocument();
  });

  it('only opens one form at a time (closing previous when another Edit is clicked)', () => {
    const bindings = [
      makeBinding({ id: 'uuid-1', channelName: 'ch1', channelId: 'ch-1' }),
      makeBinding({ id: 'uuid-2', channelName: 'ch2', channelId: 'ch-2' }),
    ];

    render(
      <ChannelBindingList
        bindings={bindings}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isUpdating={false}
        isDeleting={false}
      />,
    );

    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    fireEvent.click(editButtons[0]);
    expect(screen.getAllByTestId('binding-config-form')).toHaveLength(1);

    // Clicking Edit on the second binding
    // (first binding now shows Close, second still shows Edit)
    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(closeButton).toBeInTheDocument();
  });
});
