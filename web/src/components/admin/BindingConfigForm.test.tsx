import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BindingConfigForm } from './BindingConfigForm';
import type { ChannelBindingDto } from '@raid-ledger/contract';

// ROK-1416: the edit form gains a game autocomplete (GameSearchInput), which
// calls useGameSearch. No MSW handler exists for /games/search, so mock the
// hook (NominateModal precedent). The current 3-field form never renders the
// picker, so this mock is inert until the dev wires it in.
vi.mock('../../hooks/use-game-search', () => ({ useGameSearch: vi.fn() }));
import { useGameSearch } from '../../hooks/use-game-search';

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

const onSave = vi.fn();
const onCancel = vi.fn();

function renderBindingForm(overrides: Partial<ChannelBindingDto> = {}, isSaving = false) {
  return render(
    <BindingConfigForm
      binding={makeBinding(overrides)}
      onSave={onSave}
      onCancel={onCancel}
      isSaving={isSaving}
    />,
  );
}

function getSpinbuttonValues() {
  return screen.getAllByRole('spinbutton').map((el) => (el as HTMLInputElement).value);
}

describe('BindingConfigForm — general rendering', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the channel name in the form heading', () => {
    renderBindingForm({ channelName: 'raid-announcements' });
    expect(screen.getByText(/Edit Config: #raid-announcements/)).toBeInTheDocument();
  });

  it('falls back to channelId in heading when channelName is undefined', () => {
    renderBindingForm({ channelName: undefined, channelId: 'ch-789' });
    expect(screen.getByText(/Edit Config: #ch-789/)).toBeInTheDocument();
  });

  it('renders Save and Cancel buttons', () => {
    renderBindingForm();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

describe('BindingConfigForm — voice monitor fields', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows voice monitor fields when bindingPurpose is game-voice-monitor', () => {
    renderBindingForm({ bindingPurpose: 'game-voice-monitor' });
    expect(screen.getByText(/Minimum Players/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Auto-close event when voice empties/)).toBeInTheDocument();
    expect(screen.getByText(/Grace Period/)).toBeInTheDocument();
  });

  it('initializes minPlayers from binding config', () => {
    renderBindingForm({
      bindingPurpose: 'game-voice-monitor',
      config: { minPlayers: 7, autoClose: true, gracePeriod: 120 },
    });
    expect(getSpinbuttonValues()).toContain('7');
  });

  it('initializes gracePeriod from binding config', () => {
    renderBindingForm({
      bindingPurpose: 'game-voice-monitor',
      config: { minPlayers: 2, autoClose: true, gracePeriod: 180 },
    });
    expect(getSpinbuttonValues()).toContain('180');
  });

  it('initializes autoClose checkbox from binding config', () => {
    renderBindingForm({
      bindingPurpose: 'game-voice-monitor',
      config: { minPlayers: 2, autoClose: false, gracePeriod: 5 },
    });
    const checkbox = screen.getByLabelText(/Auto-close event when voice empties/) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });
});

describe('BindingConfigForm — voice monitor defaults', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('uses default minPlayers of 2 when config is null', () => {
    renderBindingForm({ bindingPurpose: 'game-voice-monitor', config: null });
    expect(getSpinbuttonValues()).toContain('2');
  });

  it('uses default gracePeriod of 5 when config is null', () => {
    renderBindingForm({ bindingPurpose: 'game-voice-monitor', config: null });
    expect(getSpinbuttonValues()).toContain('5');
  });

  it('defaults autoClose to true when config is null', () => {
    renderBindingForm({ bindingPurpose: 'game-voice-monitor', config: null });
    const checkbox = screen.getByLabelText(/Auto-close event when voice empties/) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('displays grace period label with minutes unit', () => {
    renderBindingForm({
      bindingPurpose: 'game-voice-monitor',
      config: { minPlayers: 2, autoClose: true, gracePeriod: 10 },
    });
    expect(screen.getByText(/minutes before closing/)).toBeInTheDocument();
  });
});

describe('BindingConfigForm — non-voice-monitor mode', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does not show voice monitor config fields for game-announcements', () => {
    renderBindingForm({ bindingPurpose: 'game-announcements' });
    expect(screen.queryByText(/Minimum Players/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Grace Period/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Auto-close event when voice empties/)).not.toBeInTheDocument();
  });

  it('shows "no additional configuration" message for announcement channels', () => {
    renderBindingForm({ bindingPurpose: 'game-announcements' });
    expect(screen.getByText(/No additional configuration needed for announcement channels/)).toBeInTheDocument();
  });

  it('shows voice fields for general-lobby (ROK-515)', () => {
    renderBindingForm({ bindingPurpose: 'general-lobby' });
    expect(screen.queryByText(/Minimum Players/)).toBeInTheDocument();
  });
});

describe('BindingConfigForm — form submission', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls onSave with binding id and config on submit', () => {
    renderBindingForm({
      id: 'uuid-1', bindingPurpose: 'game-voice-monitor',
      config: { minPlayers: 3, autoClose: true, gracePeriod: 10 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('uuid-1', {
      config: { minPlayers: 3, autoClose: true, gracePeriod: 10 },
    });
  });

  it('submits updated minPlayers value after user input', () => {
    renderBindingForm({ id: 'uuid-1', bindingPurpose: 'game-voice-monitor', config: null });
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const callArg = onSave.mock.calls[0][1] as { config: { minPlayers: number } };
    expect(callArg.config.minPlayers).toBe(10);
  });

  it('submits toggled autoClose value', () => {
    renderBindingForm({
      id: 'uuid-1', bindingPurpose: 'game-voice-monitor',
      config: { minPlayers: 2, autoClose: true, gracePeriod: 5 },
    });
    fireEvent.click(screen.getByLabelText(/Auto-close event when voice empties/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const callArg = onSave.mock.calls[0][1] as { config: { autoClose: boolean } };
    expect(callArg.config.autoClose).toBe(false);
  });
});

describe('BindingConfigForm — cancel & saving state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls onCancel when Cancel button is clicked', () => {
    renderBindingForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not call onSave when Cancel is clicked', () => {
    renderBindingForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('disables Save button when isSaving is true', () => {
    renderBindingForm({}, true);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('shows "Saving..." text when isSaving is true', () => {
    renderBindingForm({}, true);
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('shows "Save" text when isSaving is false', () => {
    renderBindingForm();
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ROK-1416 (B5-1) — purpose selector, game picker, classifier gating, config
// prune, inline heal. All RED until the dev extends BindingConfigForm; the
// current 3-field form has no purpose <select>, no game field, no classifier
// message, no saveError prop, and keys config off the PROP (not local state).
// ─────────────────────────────────────────────────────────────────────────

/** Reset call state + give GameSearchInput's hook a stable empty result. */
function resetGameSearchMock() {
  vi.clearAllMocks();
  vi.mocked(useGameSearch).mockReturnValue({
    data: undefined,
    isLoading: false,
  } as unknown as ReturnType<typeof useGameSearch>);
}

function purposeSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: /purpose/i }) as HTMLSelectElement;
}

describe('BindingConfigForm — ROK-1416 purpose selector (channelType-filtered)', () => {
  beforeEach(resetGameSearchMock);

  it('offers only voice purposes (Activity Monitor, General Lobby) for a voice channel', () => {
    renderBindingForm({
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: 1,
      gameName: 'World of Warcraft',
    });
    const select = purposeSelect();
    expect(within(select).getByRole('option', { name: /activity monitor/i })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: /general lobby/i })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /announcement/i })).not.toBeInTheDocument();
  });

  it('offers only the announcements purpose for a text channel', () => {
    renderBindingForm({ channelType: 'text', bindingPurpose: 'game-announcements' });
    const select = purposeSelect();
    expect(within(select).getByRole('option', { name: /announcement/i })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /activity monitor/i })).not.toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /general lobby/i })).not.toBeInTheDocument();
  });
});

describe('BindingConfigForm — ROK-1416 classifier gating', () => {
  beforeEach(resetGameSearchMock);

  it('blocks an inert voice monitor (no game): shows the violation and disables Save', () => {
    renderBindingForm({
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: null,
      gameName: null,
    });
    expect(screen.getByText(/must have a game/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('re-enables Save once the purpose is switched to General Lobby', async () => {
    renderBindingForm({
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: null,
      gameName: null,
    });
    const select = purposeSelect();
    await userEvent.selectOptions(
      select,
      within(select).getByRole('option', { name: /general lobby/i }),
    );
    expect(screen.queryByText(/must have a game/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
  });
});

describe('BindingConfigForm — ROK-1416 local-state conditionals (AC6)', () => {
  beforeEach(resetGameSearchMock);

  it('reveals the "Just Chatting" toggle live when switching a monitor to General Lobby', async () => {
    renderBindingForm({
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: 5,
      gameName: 'Valheim',
    });
    // Monitor with a game: no allowJustChatting toggle yet.
    expect(screen.queryByLabelText(/just chatting/i)).not.toBeInTheDocument();
    const select = purposeSelect();
    await userEvent.selectOptions(
      select,
      within(select).getByRole('option', { name: /general lobby/i }),
    );
    // Driven off LOCAL purpose state — appears without any reload.
    expect(screen.getByLabelText(/just chatting/i)).toBeInTheDocument();
  });

  it('auto-derives the purpose to General Lobby when the selected game is cleared', async () => {
    renderBindingForm({
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: 5,
      gameName: 'Valheim',
    });
    await userEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(purposeSelect().value).toBe('general-lobby');
  });

  it('focuses the game field for an inert binding (the "Fix →" repair target)', async () => {
    renderBindingForm({
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: null,
      gameName: null,
    });
    await waitFor(
      () => expect(screen.getByPlaceholderText(/search for a game/i)).toHaveFocus(),
      { timeout: 2000 },
    );
  });
});

describe('BindingConfigForm — ROK-1416 error surfacing + config prune', () => {
  beforeEach(resetGameSearchMock);

  it('renders the save error above the form actions', () => {
    render(
      <BindingConfigForm
        {...({
          binding: makeBinding({ channelType: 'voice', bindingPurpose: 'general-lobby', gameId: null }),
          onSave,
          onCancel,
          isSaving: false,
          saveError: 'That channel already has a General Lobby binding.',
        } as Parameters<typeof BindingConfigForm>[0] & { saveError?: string | null })}
      />,
    );
    expect(
      screen.getByText(/already has a General Lobby binding/i),
    ).toBeInTheDocument();
  });

  it('prunes allowJustChatting from the submitted config when leaving General Lobby', async () => {
    renderBindingForm({
      channelType: 'voice',
      bindingPurpose: 'general-lobby',
      gameId: 9,
      gameName: 'Deep Rock Galactic',
      config: { allowJustChatting: true, minPlayers: 3, autoClose: true, gracePeriod: 5 },
    });
    const select = purposeSelect();
    await userEvent.selectOptions(
      select,
      within(select).getByRole('option', { name: /activity monitor/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    const submitted = onSave.mock.calls[0][1] as { config: Record<string, unknown> };
    expect(submitted.config).not.toHaveProperty('allowJustChatting');
    expect(submitted.config.minPlayers).toBe(3);
  });
});

describe('BindingConfigForm — ROK-1416 inline heal (Convert to General Lobby)', () => {
  beforeEach(resetGameSearchMock);

  it('offers "Convert to General Lobby" for an inert binding and PATCHes the lobby purpose', async () => {
    renderBindingForm({
      id: 'inert-1',
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: null,
      gameName: null,
    });
    await userEvent.click(
      screen.getByRole('button', { name: /convert to general lobby/i }),
    );
    expect(onSave).toHaveBeenCalledWith(
      'inert-1',
      expect.objectContaining({ bindingPurpose: 'general-lobby' }),
    );
  });
});
