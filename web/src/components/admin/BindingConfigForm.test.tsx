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

const onSave = vi.fn();
const onCancel = vi.fn();
function bindingconfigformGroup1() {
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

}

function bindingconfigformGroup2() {
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

}

function bindingconfigformGroup3() {
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

}

function bindingconfigformGroup4() {
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

}

function bindingconfigformGroup5() {
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

}

function bindingconfigformGroup6() {
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

}

function bindingconfigformGroup7() {
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

}

function bindingconfigformGroup8() {
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

}

function bindingconfigformGroup9() {
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

}

function bindingconfigformGroup10() {
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

}

function bindingconfigformGroup11() {
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

}

function bindingconfigformGroup12() {
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

}

function bindingconfigformGroup13() {
it('shows voice fields for general-lobby (ROK-515)', () => {
    render(
      <BindingConfigForm
        binding={makeBinding({ bindingPurpose: 'general-lobby' })}
        onSave={onSave}
        onCancel={onCancel}
        isSaving={false}
      />,
    );

    expect(screen.queryByText(/Minimum Players/)).toBeInTheDocument();
  });

}

function bindingconfigformGroup14() {
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

}

function bindingconfigformGroup15() {
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

}

function bindingconfigformGroup16() {
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

}

function bindingconfigformGroup17() {
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

}

function bindingconfigformGroup18() {
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

}

function bindingconfigformGroup19() {
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

}

function bindingconfigformGroup20() {
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

}

describe('BindingConfigForm', () => {
beforeEach(() => {
    vi.clearAllMocks();
  });

    bindingconfigformGroup1();
    bindingconfigformGroup2();
    bindingconfigformGroup3();
    bindingconfigformGroup4();
    bindingconfigformGroup5();
    bindingconfigformGroup6();
    bindingconfigformGroup7();
    bindingconfigformGroup8();
    bindingconfigformGroup9();
    bindingconfigformGroup10();
    bindingconfigformGroup11();
    bindingconfigformGroup12();
    bindingconfigformGroup13();
    bindingconfigformGroup14();
    bindingconfigformGroup15();
    bindingconfigformGroup16();
    bindingconfigformGroup17();
    bindingconfigformGroup18();
    bindingconfigformGroup19();
    bindingconfigformGroup20();
});
