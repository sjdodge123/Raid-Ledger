/**
 * ROK-1435 (L5): the weekly digest admin card — renders stored settings, saves
 * each control as a full-object PUT, locks while saving, and shows errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WeeklyDigestSettings, WeeklyDigestSettingsResponse } from '@raid-ledger/contract';
import { WeeklyDigestSection } from './weekly-digest-section';

const BASE: WeeklyDigestSettings = { enabled: true, channelId: null, day: 1, hour: 9 };
const SAVED: WeeklyDigestSettingsResponse = { ...BASE, timezone: 'America/Chicago' };

const state = {
    status: { data: SAVED as WeeklyDigestSettingsResponse | undefined, isError: false },
    channels: { data: [{ id: 'c1', name: 'announcements' }, { id: 'c2', name: 'general' }] },
    update: { mutateAsync: vi.fn(), isPending: false },
};
vi.mock('../../hooks/admin/use-weekly-digest-settings', () => ({
    useWeeklyDigestSettings: () => state,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('../../lib/toast', () => ({
    toast: {
        success: (...a: unknown[]) => toastSuccess(...a),
        error: (...a: unknown[]) => toastError(...a),
    },
}));

function resetState() {
    vi.clearAllMocks();
    state.status = { data: { ...SAVED }, isError: false };
    state.update.isPending = false;
    state.update.mutateAsync = vi.fn(() => Promise.resolve(SAVED));
}

describe('WeeklyDigestSection (ROK-1435 L5) — render and saves', () => {
    beforeEach(resetState);

    it('renders the stored settings and names the community timezone', () => {
        render(<WeeklyDigestSection />);
        expect(screen.getByLabelText('Enable weekly digest')).toBeChecked();
        expect(screen.getByLabelText('Digest day')).toHaveValue('1');
        expect(screen.getByLabelText('Digest hour')).toHaveValue('9');
        expect(screen.getByLabelText('Channel')).toHaveValue('');
        expect(screen.getByTestId('weekly-digest-timezone')).toHaveTextContent('America/Chicago');
    });

    it('toggling off PUTs the full settings object with enabled=false and toasts', async () => {
        render(<WeeklyDigestSection />);
        fireEvent.click(screen.getByLabelText('Enable weekly digest'));
        expect(state.update.mutateAsync).toHaveBeenCalledWith({ ...BASE, enabled: false });
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Weekly digest settings saved'));
    });

    it('saves the picked day, hour and channel', () => {
        render(<WeeklyDigestSection />);
        fireEvent.change(screen.getByLabelText('Digest day'), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('Digest hour'), { target: { value: '18' } });
        fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'c2' } });
        expect(state.update.mutateAsync).toHaveBeenNthCalledWith(1, { ...BASE, day: 5 });
        expect(state.update.mutateAsync).toHaveBeenNthCalledWith(2, { ...BASE, hour: 18 });
        expect(state.update.mutateAsync).toHaveBeenNthCalledWith(3, { ...BASE, channelId: 'c2' });
    });

    it('picking the default-channel option clears the dedicated channel (null)', () => {
        state.status.data = { ...SAVED, channelId: 'c1' };
        render(<WeeklyDigestSection />);
        fireEvent.change(screen.getByLabelText('Channel'), { target: { value: '' } });
        expect(state.update.mutateAsync).toHaveBeenCalledWith({ ...BASE, channelId: null });
    });

});

describe('WeeklyDigestSection (ROK-1435 L5) — locks and errors', () => {
    beforeEach(resetState);

    it('disables day, hour and channel while the digest is off, but not the toggle', () => {
        state.status.data = { ...SAVED, enabled: false };
        render(<WeeklyDigestSection />);
        expect(screen.getByLabelText('Enable weekly digest')).toBeEnabled();
        expect(screen.getByLabelText('Digest day')).toBeDisabled();
        expect(screen.getByLabelText('Digest hour')).toBeDisabled();
        expect(screen.getByLabelText('Channel')).toBeDisabled();
    });

    it('locks every control while a save is pending', () => {
        state.update.isPending = true;
        render(<WeeklyDigestSection />);
        expect(screen.getByLabelText('Enable weekly digest')).toBeDisabled();
        expect(screen.getByLabelText('Digest day')).toBeDisabled();
        expect(screen.getByLabelText('Channel')).toBeDisabled();
    });

    it('toasts an error when the save fails', async () => {
        state.update.mutateAsync = vi.fn(() => Promise.reject(new Error('boom')));
        render(<WeeklyDigestSection />);
        fireEvent.change(screen.getByLabelText('Digest hour'), { target: { value: '3' } });
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to update weekly digest settings'));
        expect(toastSuccess).not.toHaveBeenCalled();
    });

    it('shows an alert and no pickers when the settings fail to load', () => {
        state.status = { data: undefined, isError: true };
        render(<WeeklyDigestSection />);
        expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the weekly digest settings");
        expect(screen.queryByLabelText('Digest day')).toBeNull();
        expect(screen.getByLabelText('Enable weekly digest')).toBeDisabled();
    });
});
