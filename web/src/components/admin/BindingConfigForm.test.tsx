import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BindingConfigForm } from './BindingConfigForm';
import type { ChannelBindingDto } from '@raid-ledger/contract';

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

describe('BindingConfigForm', () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── General rendering ─────────────────────────────────────────

  it('renders the channel name in the form heading', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({ channelName: 'raid-announcements' })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(screen.getByText(/Edit Config: #raid-announcements/)).toBeInTheDocument();
  });

  it('falls back to channelId in heading when channelName is undefined', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({ channelName: undefined, channelId: 'ch-789' })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(screen.getByText(/Edit Config: #ch-789/)).toBeInTheDocument();
  });

  it('renders Save and Cancel buttons', () => {
    render(
      <BindingConfigForm
        binding={makeBinding()}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  // ── Event Announcements mode (shows all config fields) ────────

  it('shows voice monitor fields when bindingPurpose is game-voice-monitor', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({ bindingPurpose: 'game-voice-monitor' })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(screen.getByText(/Minimum Players/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Auto-close event when voice empties/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Grace Period/)).toBeInTheDocument();
  });

  it('initializes minPlayers from binding config', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          bindingPurpose: 'game-voice-monitor',
          config: { minPlayers: 7, autoClose: true, gracePeriod: 120 },
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    // Find by value since there are multiple spinbuttons (minPlayers and gracePeriod)
    const inputs = screen
      .getAllByRole('spinbutton')
      .map((el) => (el as HTMLInputElement).value);
    expect(inputs).toContain('7');
  });

  it('initializes gracePeriod from binding config', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          bindingPurpose: 'game-voice-monitor',
          config: { minPlayers: 2, autoClose: true, gracePeriod: 180 },
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    const inputs = screen
      .getAllByRole('spinbutton')
      .map((el) => (el as HTMLInputElement).value);
    expect(inputs).toContain('180');
  });

  it('initializes autoClose checkbox from binding config', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          bindingPurpose: 'game-voice-monitor',
          config: { minPlayers: 2, autoClose: false, gracePeriod: 5 },
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    const checkbox = screen.getByLabelText(
      /Auto-close event when voice empties/,
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('uses default minPlayers of 2 when config is null', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          bindingPurpose: 'game-voice-monitor',
          config: null,
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    const inputs = screen
      .getAllByRole('spinbutton')
      .map((el) => (el as HTMLInputElement).value);
    expect(inputs).toContain('2');
  });

  it('uses default gracePeriod of 5 when config is null', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          bindingPurpose: 'game-voice-monitor',
          config: null,
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    const inputs = screen
      .getAllByRole('spinbutton')
      .map((el) => (el as HTMLInputElement).value);
    expect(inputs).toContain('5');
  });

  it('defaults autoClose to true when config is null', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          bindingPurpose: 'game-voice-monitor',
          config: null,
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    const checkbox = screen.getByLabelText(
      /Auto-close event when voice empties/,
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('displays grace period label with minutes unit', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          bindingPurpose: 'game-voice-monitor',
          config: { minPlayers: 2, autoClose: true, gracePeriod: 10 },
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(screen.getByText(/minutes before closing/)).toBeInTheDocument();
  });

  // ── Non-voice-monitor mode ────────────────────────────────────

  it('does not show voice monitor config fields for game-announcements', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({ bindingPurpose: 'game-announcements' })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(screen.queryByText(/Minimum Players/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Grace Period/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Auto-close event when voice empties/),
    ).not.toBeInTheDocument();
  });

  it('shows "no additional configuration" message for announcement channels', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({ bindingPurpose: 'game-announcements' })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(
      screen.getByText(
        /No additional configuration needed for announcement channels/,
      ),
    ).toBeInTheDocument();
  });

  it('does not show voice fields for general-lobby', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({ bindingPurpose: 'general-lobby' })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(screen.queryByText(/Minimum Players/)).not.toBeInTheDocument();
  });

  // ── Form submission ───────────────────────────────────────────

  it('calls onSave with binding id and config on submit', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          id: 'uuid-1',
          bindingPurpose: 'game-voice-monitor',
          config: { minPlayers: 3, autoClose: true, gracePeriod: 10 },
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith('uuid-1', {
      config: {
        minPlayers: 3,
        autoClose: true,
        gracePeriod: 10,
      },
    });
  });

  it('submits updated minPlayers value after user input', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          id: 'uuid-1',
          bindingPurpose: 'game-voice-monitor',
          config: null,
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    const inputs = screen.getAllByRole('spinbutton');
    // minPlayers is the first number input
    fireEvent.change(inputs[0], { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const callArg = onSave.mock.calls[0][1] as { config: { minPlayers: number } };
    expect(callArg.config.minPlayers).toBe(10);
  });

  it('submits toggled autoClose value', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({
          id: 'uuid-1',
          bindingPurpose: 'game-voice-monitor',
          config: { minPlayers: 2, autoClose: true, gracePeriod: 5 },
        })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    const checkbox = screen.getByLabelText(/Auto-close event when voice empties/);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const callArg = onSave.mock.calls[0][1] as { config: { autoClose: boolean } };
    expect(callArg.config.autoClose).toBe(false);
  });

  // ── Cancel button ────────────────────────────────────────────

  it('calls onCancel when Cancel button is clicked', () => {
    render(
      <BindingConfigForm
        binding={makeBinding()}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not call onSave when Cancel is clicked', () => {
    render(
      <BindingConfigForm
        binding={makeBinding()}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSave).not.toHaveBeenCalled();
  });

  // ── Saving state ─────────────────────────────────────────────

  it('disables Save button when isSaving is true', () => {
    render(
      <BindingConfigForm
        binding={makeBinding()}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={true}
      />,
    );

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('shows "Saving..." text when isSaving is true', () => {
    render(
      <BindingConfigForm
        binding={makeBinding()}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={true}
      />,
    );

    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('shows "Save" text when isSaving is false', () => {
    render(
      <BindingConfigForm
        binding={makeBinding()}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });
});
