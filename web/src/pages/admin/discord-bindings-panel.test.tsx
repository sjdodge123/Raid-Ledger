import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiscordBindingsPanel } from './discord-bindings-panel';
import type { ChannelBindingDto } from '@raid-ledger/contract';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ChannelBindingList so we can test panel behavior in isolation
vi.mock('../../components/admin/ChannelBindingList', () => ({
  ChannelBindingList: ({
    bindings,
    onUpdate,
    onDelete,
  }: {
    bindings: ChannelBindingDto[];
    onUpdate: (id: string, dto: unknown) => void;
    onDelete: (id: string) => void;
    isUpdating: boolean;
    isDeleting: boolean;
  }) => (
    <div data-testid="channel-binding-list">
      <span data-testid="binding-count">{bindings.length}</span>
      <button onClick={() => onUpdate('uuid-1', { config: {} })}>
        Trigger Update
      </button>
      <button onClick={() => onDelete('uuid-1')}>Trigger Delete</button>
    </div>
  ),
}));

// Shared mutable hook state
const mockBindings = {
  isLoading: false,
  isError: false,
  error: null as Error | null,
  data: null as { data: ChannelBindingDto[] } | null,
};

const mockUpdateBinding = {
  mutate: vi.fn(),
  isPending: false,
};

const mockDeleteBinding = {
  mutate: vi.fn(),
  isPending: false,
};

const mockDiscordBotStatus = {
  data: null as { connected: boolean } | null,
};

vi.mock('../../hooks/use-channel-bindings', () => ({
  useChannelBindings: () => ({
    bindings: mockBindings,
    updateBinding: mockUpdateBinding,
    deleteBinding: mockDeleteBinding,
    createBinding: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('../../hooks/use-admin-settings', () => ({
  useAdminSettings: () => ({
    discordBotStatus: mockDiscordBotStatus,
    // Other hooks not used by DiscordBindingsPanel
    oauthStatus: { data: null },
    updateOAuth: { mutateAsync: vi.fn(), isPending: false },
    testOAuth: { mutateAsync: vi.fn(), isPending: false },
    clearOAuth: { mutateAsync: vi.fn(), isPending: false },
    igdbStatus: { data: null },
    updateIgdb: { mutateAsync: vi.fn(), isPending: false },
    testIgdb: { mutateAsync: vi.fn(), isPending: false },
    clearIgdb: { mutateAsync: vi.fn(), isPending: false },
    blizzardStatus: { data: null },
    updateBlizzard: { mutateAsync: vi.fn(), isPending: false },
    testBlizzard: { mutateAsync: vi.fn(), isPending: false },
    clearBlizzard: { mutateAsync: vi.fn(), isPending: false },
    demoDataStatus: { data: null },
    installDemoData: { mutateAsync: vi.fn(), isPending: false },
    clearDemoData: { mutateAsync: vi.fn(), isPending: false },
    updateDiscordBot: { mutateAsync: vi.fn(), isPending: false },
    testDiscordBot: { mutateAsync: vi.fn(), isPending: false },
    clearDiscordBot: { mutateAsync: vi.fn(), isPending: false },
    checkDiscordBotPermissions: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

describe('DiscordBindingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBindings.isLoading = false;
    mockBindings.isError = false;
    mockBindings.error = null;
    mockBindings.data = null;
    mockDiscordBotStatus.data = { connected: true };
    mockUpdateBinding.isPending = false;
    mockUpdateBinding.mutate = vi.fn();
    mockDeleteBinding.isPending = false;
    mockDeleteBinding.mutate = vi.fn();
  });

  // ── Section heading and description ──────────────────────────

  it('renders the "Channel Bindings" heading', () => {
    render(<DiscordBindingsPanel />);
    expect(screen.getByText('Channel Bindings')).toBeInTheDocument();
  });

  it('renders /bind command reference in description', () => {
    render(<DiscordBindingsPanel />);
    expect(screen.getByText('/bind')).toBeInTheDocument();
  });

  // ── Event routing priority section ───────────────────────────

  it('renders the event routing priority section', () => {
    render(<DiscordBindingsPanel />);
    expect(screen.getByText('Event Routing Priority')).toBeInTheDocument();
  });

  it('lists game-specific binding as priority 1', () => {
    render(<DiscordBindingsPanel />);
    expect(screen.getByText('Game-specific binding')).toBeInTheDocument();
  });

  it('lists default text channel as priority 2', () => {
    render(<DiscordBindingsPanel />);
    expect(screen.getByText('Default text channel')).toBeInTheDocument();
  });

  it('lists no channel as priority 3', () => {
    render(<DiscordBindingsPanel />);
    expect(screen.getByText('No channel')).toBeInTheDocument();
  });

  // ── Bot not connected banner ──────────────────────────────────

  it('shows disconnection warning when bot is not connected', () => {
    mockDiscordBotStatus.data = { connected: false };

    render(<DiscordBindingsPanel />);

    expect(
      screen.getByText(/The Discord bot is not connected/),
    ).toBeInTheDocument();
  });

  it('does not show disconnection warning when bot is connected', () => {
    mockDiscordBotStatus.data = { connected: true };

    render(<DiscordBindingsPanel />);

    expect(
      screen.queryByText(/The Discord bot is not connected/),
    ).not.toBeInTheDocument();
  });

  it('shows disconnection warning when status data is null (treated as disconnected)', () => {
    mockDiscordBotStatus.data = null;

    render(<DiscordBindingsPanel />);

    // null data → connected defaults to false → warning is shown
    expect(
      screen.getByText(/The Discord bot is not connected/),
    ).toBeInTheDocument();
  });

  it('shows a link to Discord Bot settings in the warning', () => {
    mockDiscordBotStatus.data = { connected: false };

    render(<DiscordBindingsPanel />);

    const link = screen.getByRole('link', { name: 'Discord Bot settings' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      'href',
      '/admin/settings/integrations/discord-bot',
    );
  });

  // ── Loading state ─────────────────────────────────────────────

  it('does not show ChannelBindingList when loading', () => {
    mockBindings.isLoading = true;

    render(<DiscordBindingsPanel />);

    expect(screen.queryByTestId('channel-binding-list')).not.toBeInTheDocument();
  });

  // ── Error state ───────────────────────────────────────────────

  it('shows error message when bindings fail to load', () => {
    mockBindings.isError = true;
    mockBindings.error = new Error('Network error');

    render(<DiscordBindingsPanel />);

    expect(screen.getByText(/Failed to load bindings/)).toBeInTheDocument();
  });

  it('shows the specific error message from the error object', () => {
    mockBindings.isError = true;
    mockBindings.error = new Error('Network error');

    render(<DiscordBindingsPanel />);

    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it('does not show ChannelBindingList when error', () => {
    mockBindings.isError = true;
    mockBindings.error = new Error('error');

    render(<DiscordBindingsPanel />);

    expect(screen.queryByTestId('channel-binding-list')).not.toBeInTheDocument();
  });

  // ── Loaded state with bindings ────────────────────────────────

  it('renders ChannelBindingList with bindings from the hook', () => {
    mockBindings.data = {
      data: [
        {
          id: 'b-1',
          guildId: 'g-1',
          channelId: 'ch-1',
          channelName: 'general',
          channelType: 'text',
          bindingPurpose: 'game-announcements',
          gameId: null,
          config: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
      ],
    };

    render(<DiscordBindingsPanel />);

    expect(screen.getByTestId('channel-binding-list')).toBeInTheDocument();
    expect(screen.getByTestId('binding-count').textContent).toBe('1');
  });

  it('renders ChannelBindingList with empty array when data is null', () => {
    mockBindings.data = null;

    render(<DiscordBindingsPanel />);

    expect(screen.getByTestId('channel-binding-list')).toBeInTheDocument();
    expect(screen.getByTestId('binding-count').textContent).toBe('0');
  });

  // ── Update / Delete mutation wiring ──────────────────────────

  it('calls updateBinding.mutate when onUpdate is triggered', () => {
    render(<DiscordBindingsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Update' }));

    expect(mockUpdateBinding.mutate).toHaveBeenCalledWith(
      { id: 'uuid-1', dto: { config: {} } },
      expect.objectContaining({
        onSuccess: expect.any(Function) as unknown,
        onError: expect.any(Function) as unknown,
      }),
    );
  });

  it('calls deleteBinding.mutate when onDelete is triggered', () => {
    render(<DiscordBindingsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Delete' }));

    expect(mockDeleteBinding.mutate).toHaveBeenCalledWith(
      'uuid-1',
      expect.objectContaining({
        onSuccess: expect.any(Function) as unknown,
        onError: expect.any(Function) as unknown,
      }),
    );
  });
});
