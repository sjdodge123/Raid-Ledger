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

    it('saves the picked day, hour and channel', async () => {
        render(<WeeklyDigestSection />);
        fireEvent.change(screen.getByLabelText('Digest day'), { target: { value: '5' } });
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
        fireEvent.change(screen.getByLabelText('Digest hour'), { target: { value: '18' } });
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(2));
        fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'c2' } });
        expect(state.update.mutateAsync).toHaveBeenNthCalledWith(1, { ...BASE, day: 5 });
        expect(state.update.mutateAsync).toHaveBeenNthCalledWith(2, { ...BASE, hour: 18 });
        expect(state.update.mutateAsync).toHaveBeenNthCalledWith(3, { ...BASE, channelId: 'c2' });
    });

});

describe('WeeklyDigestSection (ROK-1435 L5) — saves run one at a time (Codex P2)', () => {
    beforeEach(resetState);

    it('three rapid edits while the first save is pending send exactly two PUTs (Codex P2)', async () => {
        let resolveFirst: (v: WeeklyDigestSettingsResponse) => void = () => undefined;
        const first = new Promise<WeeklyDigestSettingsResponse>((r) => { resolveFirst = r; });
        state.update.mutateAsync = vi.fn()
            .mockImplementationOnce(() => first)
            .mockImplementation(() => Promise.resolve(SAVED));
        render(<WeeklyDigestSection />);
        fireEvent.change(screen.getByLabelText('Digest day'), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('Digest hour'), { target: { value: '18' } });
        fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'c2' } });
        expect(state.update.mutateAsync, 'no second PUT while the first is in flight').toHaveBeenCalledTimes(1);
        resolveFirst({ ...SAVED, day: 5 });
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(2));
        expect(state.update.mutateAsync).toHaveBeenCalledTimes(2);
        expect(state.update.mutateAsync).toHaveBeenNthCalledWith(1, { ...BASE, day: 5 });
        expect(state.update.mutateAsync).toHaveBeenNthCalledWith(2, { ...BASE, day: 5, hour: 18, channelId: 'c2' });
    });

    it('the newer PUT is only sent after the older one settles, even when it fails (Codex P2)', async () => {
        const order: string[] = [];
        let rejectFirst: (e: Error) => void = () => undefined;
        state.update.mutateAsync = vi.fn()
            .mockImplementationOnce(() => { order.push('send day'); return new Promise((_, rej) => { rejectFirst = rej; }); })
            .mockImplementation(() => { order.push('send hour'); return Promise.resolve(SAVED); });
        render(<WeeklyDigestSection />);
        fireEvent.change(screen.getByLabelText('Digest day'), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('Digest hour'), { target: { value: '18' } });
        order.push('day settles');
        rejectFirst(new Error('boom'));
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
        expect(toastError).toHaveBeenCalledTimes(1);
        expect(order, 'the hour PUT must wait for the day PUT to settle').toEqual(['send day', 'day settles', 'send hour']);
        expect(state.update.mutateAsync).toHaveBeenLastCalledWith({ ...BASE, day: 5, hour: 18 });
    });

    it('a failed save is retried when a later edit lands back on the same payload (Codex P2)', async () => {
        let rejectFirst: (e: Error) => void = () => undefined;
        state.update.mutateAsync = vi.fn()
            .mockImplementationOnce(() => new Promise((_, rej) => { rejectFirst = rej; }))
            .mockImplementation(() => Promise.resolve(SAVED));
        render(<WeeklyDigestSection />);
        fireEvent.change(screen.getByLabelText('Digest day'), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('Digest day'), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText('Digest day'), { target: { value: '5' } });
        rejectFirst(new Error('boom'));
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
        expect(state.update.mutateAsync, 'the failed day=5 save must be re-sent, not treated as already saved')
            .toHaveBeenCalledTimes(2);
        expect(state.update.mutateAsync).toHaveBeenLastCalledWith({ ...BASE, day: 5 });
    });

});

describe('WeeklyDigestSection (ROK-1435 L5) — channel', () => {
    beforeEach(resetState);

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
