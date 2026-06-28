/**
 * ROK-1352: admin ephemeral-voice section — toggle + gated config fields.
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

describe('EphemeralVoiceSection (ROK-1352)', () => {
    beforeEach(() => {
        state.updateEphemeralVoice.mutate = vi.fn();
    });

    it('hides config fields when disabled, shows toggle', () => {
        state.ephemeralVoiceConfig.data.enabled = false;
        render(<EphemeralVoiceSection />);
        expect(
            screen.getByLabelText('Enable ephemeral voice channels'),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText('Parent category')).not.toBeInTheDocument();
    });

    it('shows category + minute inputs when enabled', () => {
        state.ephemeralVoiceConfig.data.enabled = true;
        render(<EphemeralVoiceSection />);
        expect(screen.getByLabelText('Create buffer (min)')).toBeInTheDocument();
        expect(screen.getByLabelText('Idle window (min)')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Events' })).toBeInTheDocument();
    });

    it('saves the toggle on change', () => {
        state.ephemeralVoiceConfig.data.enabled = false;
        render(<EphemeralVoiceSection />);
        fireEvent.click(screen.getByLabelText('Enable ephemeral voice channels'));
        expect(state.updateEphemeralVoice.mutate).toHaveBeenCalledWith(
            { enabled: true },
            expect.any(Object),
        );
    });
});
