/**
 * ROK-1352: per-event ephemeral-voice toggle — gated on the global master flag.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EphemeralVoiceToggle } from './ephemeral-voice-toggle';

const ephemeralVoiceConfig = { data: { enabled: false } as { enabled: boolean } };
vi.mock('../../hooks/use-admin-settings', () => ({
    useAdminSettings: () => ({ ephemeralVoiceConfig }),
}));

describe('EphemeralVoiceToggle (ROK-1352)', () => {
    it('renders nothing when the global toggle is off', () => {
        ephemeralVoiceConfig.data = { enabled: false };
        const { container } = render(
            <EphemeralVoiceToggle value={null} onChange={vi.fn()} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the toggle when the global flag is on', () => {
        ephemeralVoiceConfig.data = { enabled: true };
        render(<EphemeralVoiceToggle value={null} onChange={vi.fn()} />);
        expect(
            screen.getByLabelText('Ephemeral voice channel for this event'),
        ).toBeInTheDocument();
    });

    it('emits true when checked and null when unchecked (inherit)', () => {
        ephemeralVoiceConfig.data = { enabled: true };
        const onChange = vi.fn();
        render(<EphemeralVoiceToggle value={null} onChange={onChange} />);
        const box = screen.getByLabelText(
            'Ephemeral voice channel for this event',
        );
        fireEvent.click(box);
        expect(onChange).toHaveBeenCalledWith(true);
    });
});
