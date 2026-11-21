/**
 * SigninReminderSettingsForm (ROK-2284): renders the stored switch + weeks +
 * max, the switch saves at once with the stored numbers, Save sends valid
 * numbers with the stored switch, out-of-range input errors inline without a
 * PUT, and a server rejection or failed load is shown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from '../../lib/toast';
import { SigninReminderSettingsForm } from './SigninReminderSettingsForm';

type Dto = { enabled: boolean; weeks: number; max: number };

const mocks = vi.hoisted(() => ({
    signinReminder: { isLoading: false, isError: false, data: undefined as Dto | undefined },
    updateSigninReminder: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('../../hooks/admin/use-signin-reminder-settings', () => ({
    useSigninReminderSettings: () => mocks,
}));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const toggle = () => screen.getByRole('switch', { name: "Remind members who haven't signed in" });
const weeks = () => screen.getByRole('spinbutton', { name: 'Remind every (weeks)' });
const max = () => screen.getByRole('spinbutton', { name: 'At most (reminders)' });
const save = () => screen.getByRole('button', { name: 'Save' });

async function enter(field: HTMLElement, value: string) {
    const user = userEvent.setup();
    await user.clear(field);
    if (value !== '') await user.type(field, value);
    return user;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.signinReminder.isLoading = false;
    mocks.signinReminder.isError = false;
    mocks.signinReminder.data = { enabled: true, weeks: 3, max: 3 };
    mocks.updateSigninReminder.isPending = false;
    mocks.updateSigninReminder.mutateAsync.mockImplementation((d: Dto) => Promise.resolve(d));
});

describe('SigninReminderSettingsForm — render', () => {
    it('the shipped default (switch unset ⇒ OFF, 3 weeks, max 3) renders the switch off', () => {
        mocks.signinReminder.data = { enabled: false, weeks: 3, max: 3 };
        render(<SigninReminderSettingsForm />);
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
        expect(weeks()).toHaveValue(3);
        expect(max()).toHaveValue(3);
    });

    it('shows the switch off until the settings have loaded', () => {
        mocks.signinReminder.isLoading = true;
        mocks.signinReminder.data = undefined;
        render(<SigninReminderSettingsForm />);
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
    });

    it('shows the stored switch, weeks and max with their ranges', () => {
        mocks.signinReminder.data = { enabled: false, weeks: 6, max: 2 };
        render(<SigninReminderSettingsForm />);
        expect(screen.getByRole('heading', { name: 'Sign-in reminders' })).toBeInTheDocument();
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
        expect(weeks()).toHaveValue(6);
        expect(weeks()).toHaveAttribute('min', '1');
        expect(weeks()).toHaveAttribute('max', '12');
        expect(max()).toHaveValue(2);
        expect(max()).toHaveAttribute('max', '10');
        expect(weeks()).toHaveAccessibleDescription(/1–12, default 3\./);
    });

    it('shows a loading line and a disabled switch while loading', () => {
        mocks.signinReminder.isLoading = true;
        mocks.signinReminder.data = undefined;
        render(<SigninReminderSettingsForm />);
        expect(screen.getByText('Loading sign-in reminder settings…')).toBeInTheDocument();
        expect(toggle()).toBeDisabled();
        expect(screen.queryByRole('spinbutton')).toBeNull();
    });

    it('shows a load error instead of empty fields when the GET fails', () => {
        mocks.signinReminder.isError = true;
        mocks.signinReminder.data = undefined;
        render(<SigninReminderSettingsForm />);
        expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load sign-in reminder settings.");
        expect(toggle()).toBeDisabled();
    });
});

describe('SigninReminderSettingsForm — switch', () => {
    it('turning it off saves at once with the stored weeks and max', async () => {
        mocks.signinReminder.data = { enabled: true, weeks: 4, max: 5 };
        render(<SigninReminderSettingsForm />);
        await userEvent.setup().click(toggle());
        expect(mocks.updateSigninReminder.mutateAsync).toHaveBeenCalledWith({ enabled: false, weeks: 4, max: 5 });
        expect(toast.success).toHaveBeenCalledWith('Sign-in reminders turned off.');
    });

    it('a rejected toggle shows the server message as an error toast', async () => {
        mocks.updateSigninReminder.mutateAsync.mockRejectedValue(new Error('Forbidden'));
        render(<SigninReminderSettingsForm />);
        await userEvent.setup().click(toggle());
        expect(toast.error).toHaveBeenCalledWith('Forbidden');
        expect(toast.success).not.toHaveBeenCalled();
    });
});

describe('SigninReminderSettingsForm — weeks and max', () => {
    it('Save sends the new numbers with the stored switch', async () => {
        mocks.signinReminder.data = { enabled: false, weeks: 3, max: 3 };
        render(<SigninReminderSettingsForm />);
        await enter(weeks(), '8');
        const user = await enter(max(), '10');
        await user.click(save());
        expect(mocks.updateSigninReminder.mutateAsync).toHaveBeenCalledWith({ enabled: false, weeks: 8, max: 10 });
        expect(toast.success).toHaveBeenCalledWith('Sign-in reminder settings saved.');
    });

    it.each([
        ['weeks', '13', 'Enter a whole number from 1 to 12.'],
        ['weeks', '0', 'Enter a whole number from 1 to 12.'],
        ['weeks', '', 'Enter a whole number from 1 to 12.'],
        ['max', '11', 'Enter a whole number from 1 to 10.'],
        ['max', '0', 'Enter a whole number from 1 to 10.'],
    ])('%s = "%s" errors inline and sends nothing', async (which, value, message) => {
        render(<SigninReminderSettingsForm />);
        const field = which === 'weeks' ? weeks() : max();
        const user = await enter(field, value);
        await user.click(save());
        expect(screen.getByRole('alert')).toHaveTextContent(message);
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(mocks.updateSigninReminder.mutateAsync).not.toHaveBeenCalled();
    });

    it('editing a field clears its error', async () => {
        render(<SigninReminderSettingsForm />);
        const user = await enter(weeks(), '99');
        await user.click(save());
        expect(screen.getByRole('alert')).toBeInTheDocument();
        await enter(weeks(), '5');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a server rejection on Save is an error toast and keeps the draft', async () => {
        mocks.updateSigninReminder.mutateAsync.mockRejectedValue(new Error('weeks out of range'));
        render(<SigninReminderSettingsForm />);
        const user = await enter(weeks(), '7');
        await user.click(save());
        expect(toast.error).toHaveBeenCalledWith('weeks out of range');
        expect(weeks()).toHaveValue(7);
    });
});
