/**
 * ChannelSelector — the admin channel picker on the Field + Select primitives
 * (ROK-1646 ratchet, ROK-1435): label/hint wiring, the empty option's two
 * modes, save-on-change and the error callback.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChannelSelector, type ChannelSelectorProps } from './channel-selector';

const CHANNELS = [{ id: 'c1', name: 'announcements' }, { id: 'c2', name: 'general' }];

function renderSelector(over: Partial<ChannelSelectorProps> = {}) {
    const props: ChannelSelectorProps = {
        id: 'discordChannel', label: 'Default Notification Channel', channels: CHANNELS, value: 'c1',
        isPending: false, prefix: '#', hint: 'Where event posts go.',
        onChange: vi.fn(() => Promise.resolve()), onError: vi.fn(), ...over,
    };
    render(<ChannelSelector {...props} />);
    return { props, select: screen.getByRole('combobox', { name: props.label }) };
}

describe('ChannelSelector', () => {
    it('names the select by its label, keeps the id and describes it with the hint', () => {
        const { select } = renderSelector();
        expect(select).toHaveAttribute('id', 'discordChannel');
        expect(select).toHaveValue('c1');
        expect(select).toHaveAccessibleDescription('Where event posts go.');
        expect(screen.getByRole('option', { name: '#general' })).toBeInTheDocument();
    });

    it('saves the picked channel', () => {
        const { select, props } = renderSelector();
        fireEvent.change(select, { target: { value: 'c2' } });
        expect(props.onChange).toHaveBeenCalledWith('c2');
    });

    it('without clearLabel the empty option is a disabled prompt and never saves', () => {
        const { select, props } = renderSelector({ value: '' });
        expect(screen.getByRole('option', { name: 'Select a channel...' })).toBeDisabled();
        fireEvent.change(select, { target: { value: '' } });
        expect(props.onChange).not.toHaveBeenCalled();
    });

    it('with clearLabel the empty option is selectable and saves an empty id', () => {
        const { select, props } = renderSelector({ clearLabel: 'Use the default channel' });
        expect(screen.getByRole('option', { name: 'Use the default channel' })).toBeEnabled();
        fireEvent.change(select, { target: { value: '' } });
        expect(props.onChange).toHaveBeenCalledWith('');
    });

    it('calls onError when the save rejects', async () => {
        const { select, props } = renderSelector({ onChange: vi.fn(() => Promise.reject(new Error('boom'))) });
        fireEvent.change(select, { target: { value: 'c2' } });
        await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(1));
    });

    it('is disabled while a save is pending', () => {
        const { select } = renderSelector({ isPending: true });
        expect(select).toBeDisabled();
    });

    it('is disabled when the disabled prop is set', () => {
        const { select } = renderSelector({ disabled: true });
        expect(select).toBeDisabled();
    });
});
