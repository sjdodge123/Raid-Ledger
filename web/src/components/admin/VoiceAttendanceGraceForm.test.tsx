/**
 * VoiceAttendanceGraceForm (ROK-1940, AC-7): renders the stored grace, saves a
 * valid whole number 0–60, rejects anything else inline without calling the
 * API, and surfaces a server rejection as an error toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from '../../lib/toast';
import { VoiceAttendanceGraceForm } from './VoiceAttendanceGraceForm';

const mocks = vi.hoisted(() => ({
    voiceAttendance: { isLoading: false, data: { graceMinutes: 5 } as { graceMinutes: number } | undefined },
    updateVoiceAttendance: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('../../hooks/admin/use-voice-attendance-settings', () => ({
    useVoiceAttendanceSettings: () => mocks,
}));

vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RANGE_ERROR = 'Enter a whole number from 0 to 60.';
const field = () => screen.getByRole('spinbutton', { name: 'Late after (minutes)' });

async function enterAndSave(value: string) {
    const user = userEvent.setup();
    render(<VoiceAttendanceGraceForm />);
    await user.clear(field());
    if (value !== '') await user.type(field(), value);
    await user.click(screen.getByRole('button', { name: 'Save' }));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.voiceAttendance.isLoading = false;
    mocks.voiceAttendance.data = { graceMinutes: 5 };
    mocks.updateVoiceAttendance.isPending = false;
    mocks.updateVoiceAttendance.mutateAsync.mockResolvedValue({ graceMinutes: 5 });
});

describe('VoiceAttendanceGraceForm — render', () => {
    it('shows the stored grace in a 0–60 spinbutton described by its hint', () => {
        mocks.voiceAttendance.data = { graceMinutes: 12 };
        render(<VoiceAttendanceGraceForm />);
        expect(screen.getByRole('heading', { name: 'Voice attendance' })).toBeInTheDocument();
        expect(field()).toHaveValue(12);
        expect(field()).toHaveAttribute('min', '0');
        expect(field()).toHaveAttribute('max', '60');
        expect(field()).toHaveAccessibleDescription(/0–60, default 5\. Applies to events that end after you save\./);
    });
});

describe('VoiceAttendanceGraceForm — save', () => {
    it.each([['0', 0], ['60', 60], ['10', 10]])('saves %s and toasts success', async (typed, sent) => {
        await enterAndSave(typed);
        expect(mocks.updateVoiceAttendance.mutateAsync).toHaveBeenCalledWith(sent);
        expect(toast.success).toHaveBeenCalledWith('Voice attendance grace saved.');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each(['61', '-1', '2.5', ''])('rejects %j inline and never calls the API', async (typed) => {
        await enterAndSave(typed);
        expect(screen.getByRole('alert')).toHaveTextContent(RANGE_ERROR);
        expect(field()).toHaveAttribute('aria-invalid', 'true');
        expect(mocks.updateVoiceAttendance.mutateAsync).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows the server error as an error toast', async () => {
        mocks.updateVoiceAttendance.mutateAsync.mockRejectedValue(new Error('graceMinutes must be an integer 0–60'));
        await enterAndSave('30');
        expect(toast.error).toHaveBeenCalledWith('graceMinutes must be an integer 0–60');
        expect(toast.success).not.toHaveBeenCalled();
    });
});
