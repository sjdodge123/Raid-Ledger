/**
 * ROK-1352: admin ephemeral-voice section — toggle + gated config fields.
 * ROK-1652 (E11): the shared Switch, Checkbox, Field, Select and Input.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EphemeralVoiceSection } from './ephemeral-voice-section';

const state = {
    ephemeralVoiceConfig: {
        data: {
            enabled: false,
            categoryId: null,
            createBufferMinutes: 30,
            idleMinutes: 30,
        } as Record<string, unknown>,
    },
    ephemeralVoiceCategories: { data: [{ id: 'c1', name: 'Events' }] },
    updateEphemeralVoice: { mutate: vi.fn(), isPending: false },
};
vi.mock('../../hooks/use-admin-settings', () => ({
    useAdminSettings: () => state,
}));
vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

const FORCE_NAME = 'Always create a temporary channel for every event';
const FORCE_DESC = 'Raid Ledger never points events at existing/static voice channels.';

function renderWith(enabled: boolean, extra: Record<string, unknown> = {}) {
    state.ephemeralVoiceConfig.data = {
        enabled, categoryId: null, createBufferMinutes: 30, idleMinutes: 30, ...extra,
    };
    return render(<EphemeralVoiceSection />);
}

beforeEach(() => {
    state.updateEphemeralVoice.mutate = vi.fn();
    state.updateEphemeralVoice.isPending = false;
});

describe('EphemeralVoiceSection (ROK-1352)', () => {
    it('hides config fields when disabled, shows toggle', () => {
        renderWith(false);
        expect(
            screen.getByRole('switch', { name: 'Enable ephemeral voice channels' }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText('Parent category')).not.toBeInTheDocument();
    });

    it('shows category + minute inputs when enabled', () => {
        renderWith(true);
        expect(screen.getByLabelText('Create buffer (min)')).toBeInTheDocument();
        expect(screen.getByLabelText('Idle window (min)')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Events' })).toBeInTheDocument();
    });

    it('saves the toggle on change', () => {
        renderWith(false);
        fireEvent.click(screen.getByRole('switch', { name: 'Enable ephemeral voice channels' }));
        expect(state.updateEphemeralVoice.mutate).toHaveBeenCalledWith(
            { enabled: true },
            expect.any(Object),
        );
    });
});

describe('EphemeralVoiceSection — enable switch (ROK-1652 E11)', () => {
    it('reports its state through aria-checked', () => {
        renderWith(true);
        const sw = screen.getByRole('switch', { name: 'Enable ephemeral voice channels' });
        expect(sw).toHaveAttribute('aria-checked', 'true');
    });

    it('is disabled while the write is pending', () => {
        state.updateEphemeralVoice.isPending = true;
        renderWith(false);
        expect(screen.getByRole('switch', { name: 'Enable ephemeral voice channels' })).toBeDisabled();
    });
});

describe('EphemeralVoiceSection — force checkbox (ROK-1652 E11)', () => {
    it('is a checkbox named by its visible label, with a description', () => {
        renderWith(true, { forced: false });
        const box = screen.getByRole('checkbox', { name: FORCE_NAME });
        expect(box).not.toBeChecked();
        expect(box).toHaveAccessibleDescription(FORCE_DESC);
    });

    it('saves forced on click', () => {
        renderWith(true, { forced: false });
        fireEvent.click(screen.getByRole('checkbox', { name: FORCE_NAME }));
        expect(state.updateEphemeralVoice.mutate).toHaveBeenCalledWith(
            { forced: true },
            expect.any(Object),
        );
    });
});

describe('EphemeralVoiceSection — config fields (ROK-1652 E11)', () => {
    it('renders Parent category as the shared small Select', () => {
        renderWith(true);
        const select = screen.getByRole('combobox', { name: 'Parent category' });
        expect(
            select.parentElement?.querySelector('[data-testid="select-chevron"]'),
            'shared Select chevron beside Parent category',
        ).not.toBeNull();
        expect(select).toHaveClass('lg:min-h-9');
    });

    it('renders the minute inputs as small number Inputs', () => {
        renderWith(true);
        for (const name of ['Create buffer (min)', 'Idle window (min)']) {
            const input = screen.getByRole('spinbutton', { name });
            expect(input).toHaveClass('lg:min-h-9');
            expect(input).toHaveValue(30);
        }
    });
});

describe('EphemeralVoiceSection — minute commit (ROK-1652 E11)', () => {
    it('commits a changed minute value on blur', () => {
        renderWith(true);
        const input = screen.getByRole('spinbutton', { name: 'Idle window (min)' });
        fireEvent.change(input, { target: { value: '45' } });
        fireEvent.blur(input);
        expect(state.updateEphemeralVoice.mutate).toHaveBeenCalledWith(
            { idleMinutes: 45 },
            expect.any(Object),
        );
    });

    it('does not commit an unchanged value', () => {
        renderWith(true);
        fireEvent.blur(screen.getByRole('spinbutton', { name: 'Create buffer (min)' }));
        expect(state.updateEphemeralVoice.mutate).not.toHaveBeenCalled();
    });

    it('uses no raw colour classes', () => {
        const { container } = renderWith(true);
        expect(container.innerHTML).not.toMatch(/emerald|bg-white/);
    });
});
