/**
 * ROK-1352: per-event ephemeral-voice toggle — gated on the member-readable
 * system status (master flag) with a force-ephemeral on+disabled mode.
 * ROK-1386: nested private (roster-only) checkbox, shown only when ephemeral
 * voice is effectively on.
 * ROK-1649 (ruling 12): both are the shared Checkbox, named by their visible
 * text — the old hidden aria-label strings are gone, so the queries below go
 * by role + accessible name.
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

const VOICE_LABEL = 'Create a temporary voice channel for this event';
const FORCED_LABEL =
    'A temporary voice channel will be created for this event (enabled by admin)';
const PRIVATE_LABEL = 'Private — only rostered members can join';

const box = (name: string) => screen.getByRole('checkbox', { name });
const queryBox = (name: string) => screen.queryByRole('checkbox', { name });

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
        expect(box(VOICE_LABEL)).toBeInTheDocument();
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
        fireEvent.click(box(VOICE_LABEL));
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
        const forcedBox = box(FORCED_LABEL) as HTMLInputElement;
        expect(forcedBox.checked).toBe(true);
        expect(forcedBox.disabled).toBe(true);
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
        expect(queryBox(PRIVATE_LABEL)).not.toBeInTheDocument();
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
        expect(box(PRIVATE_LABEL)).toBeInTheDocument();
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
        expect(box(PRIVATE_LABEL)).toBeInTheDocument();
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
        fireEvent.click(box(PRIVATE_LABEL));
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
        fireEvent.click(box(VOICE_LABEL));
        expect(onPrivateChange).toHaveBeenCalledWith(null);
    });
});
