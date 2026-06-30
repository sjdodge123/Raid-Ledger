/**
 * ROK-1352: per-event ephemeral-voice toggle — gated on the member-readable
 * system status (master flag) with a force-ephemeral on+disabled mode.
 * ROK-1386: nested private (roster-only) checkbox, shown only when ephemeral
 * voice is effectively on.
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

const PRIVATE_LABEL = 'Private event — only rostered members can join';

describe('EphemeralVoiceToggle (ROK-1352)', () => {
    beforeEach(() => {
        status.data = {};
    });

    it('renders nothing when the master toggle is off', () => {
        status.data = { ephemeralVoiceEnabled: false };
        const { container } = render(
            <EphemeralVoiceToggle
                value={null}
                onChange={vi.fn()}
                privateValue={null}
                onPrivateChange={vi.fn()}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the toggle when the master flag is on', () => {
        status.data = { ephemeralVoiceEnabled: true };
        render(
            <EphemeralVoiceToggle
                value={null}
                onChange={vi.fn()}
                privateValue={null}
                onPrivateChange={vi.fn()}
            />,
        );
        expect(
            screen.getByLabelText('Ephemeral voice channel for this event'),
        ).toBeInTheDocument();
    });

    it('emits true when checked and null when unchecked (inherit)', () => {
        status.data = { ephemeralVoiceEnabled: true };
        const onChange = vi.fn();
        render(
            <EphemeralVoiceToggle
                value={null}
                onChange={onChange}
                privateValue={null}
                onPrivateChange={vi.fn()}
            />,
        );
        fireEvent.click(
            screen.getByLabelText('Ephemeral voice channel for this event'),
        );
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('renders on + disabled when force-ephemeral is enabled', () => {
        status.data = { ephemeralVoiceEnabled: true, ephemeralVoiceForced: true };
        render(
            <EphemeralVoiceToggle
                value={null}
                onChange={vi.fn()}
                privateValue={null}
                onPrivateChange={vi.fn()}
            />,
        );
        const box = screen.getByLabelText(
            'Ephemeral voice channel for this event',
        ) as HTMLInputElement;
        expect(box.checked).toBe(true);
        expect(box.disabled).toBe(true);
    });
});

describe('EphemeralVoiceToggle — private checkbox (ROK-1386)', () => {
    beforeEach(() => {
        status.data = {};
    });

    it('hides the private checkbox while ephemeral voice is off', () => {
        status.data = { ephemeralVoiceEnabled: true };
        render(
            <EphemeralVoiceToggle
                value={null}
                onChange={vi.fn()}
                privateValue={null}
                onPrivateChange={vi.fn()}
            />,
        );
        expect(screen.queryByLabelText(PRIVATE_LABEL)).not.toBeInTheDocument();
    });

    it('shows the private checkbox when ephemeral voice is on', () => {
        status.data = { ephemeralVoiceEnabled: true };
        render(
            <EphemeralVoiceToggle
                value={true}
                onChange={vi.fn()}
                privateValue={null}
                onPrivateChange={vi.fn()}
            />,
        );
        expect(screen.getByLabelText(PRIVATE_LABEL)).toBeInTheDocument();
    });

    it('shows the private checkbox when force-ephemeral is enabled', () => {
        status.data = { ephemeralVoiceEnabled: true, ephemeralVoiceForced: true };
        render(
            <EphemeralVoiceToggle
                value={null}
                onChange={vi.fn()}
                privateValue={null}
                onPrivateChange={vi.fn()}
            />,
        );
        expect(screen.getByLabelText(PRIVATE_LABEL)).toBeInTheDocument();
    });

    it('emits true/null from the private checkbox', () => {
        status.data = { ephemeralVoiceEnabled: true };
        const onPrivateChange = vi.fn();
        render(
            <EphemeralVoiceToggle
                value={true}
                onChange={vi.fn()}
                privateValue={null}
                onPrivateChange={onPrivateChange}
            />,
        );
        fireEvent.click(screen.getByLabelText(PRIVATE_LABEL));
        expect(onPrivateChange).toHaveBeenCalledWith(true);
    });

    it('resets private to null when ephemeral voice is unchecked', () => {
        status.data = { ephemeralVoiceEnabled: true };
        const onPrivateChange = vi.fn();
        render(
            <EphemeralVoiceToggle
                value={true}
                onChange={vi.fn()}
                privateValue={true}
                onPrivateChange={onPrivateChange}
            />,
        );
        fireEvent.click(
            screen.getByLabelText('Ephemeral voice channel for this event'),
        );
        expect(onPrivateChange).toHaveBeenCalledWith(null);
    });
});
