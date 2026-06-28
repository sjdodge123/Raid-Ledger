/**
 * ROK-1352: per-event ephemeral-voice toggle — gated on the member-readable
 * system status (master flag) with a force-ephemeral on+disabled mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EphemeralVoiceToggle } from './ephemeral-voice-toggle';

const status: {
    data: { ephemeralVoiceEnabled?: boolean; ephemeralVoiceForced?: boolean };
} = { data: {} };
vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => status,
}));

describe('EphemeralVoiceToggle (ROK-1352)', () => {
    beforeEach(() => {
        status.data = {};
    });

    it('renders nothing when the master toggle is off', () => {
        status.data = { ephemeralVoiceEnabled: false };
        const { container } = render(
            <EphemeralVoiceToggle value={null} onChange={vi.fn()} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the toggle when the master flag is on', () => {
        status.data = { ephemeralVoiceEnabled: true };
        render(<EphemeralVoiceToggle value={null} onChange={vi.fn()} />);
        expect(
            screen.getByLabelText('Ephemeral voice channel for this event'),
        ).toBeInTheDocument();
    });

    it('emits true when checked and null when unchecked (inherit)', () => {
        status.data = { ephemeralVoiceEnabled: true };
        const onChange = vi.fn();
        render(<EphemeralVoiceToggle value={null} onChange={onChange} />);
        fireEvent.click(
            screen.getByLabelText('Ephemeral voice channel for this event'),
        );
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('renders on + disabled when force-ephemeral is enabled', () => {
        status.data = { ephemeralVoiceEnabled: true, ephemeralVoiceForced: true };
        render(<EphemeralVoiceToggle value={null} onChange={vi.fn()} />);
        const box = screen.getByLabelText(
            'Ephemeral voice channel for this event',
        ) as HTMLInputElement;
        expect(box.checked).toBe(true);
        expect(box.disabled).toBe(true);
    });
});
