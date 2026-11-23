import { useState } from 'react';
import {
    SIGNIN_REMINDER_MAX_BOUNDS,
    SIGNIN_REMINDER_WEEKS_BOUNDS,
    type SigninReminderSettingsDto,
} from '@raid-ledger/contract';
import { toast } from '../../lib/toast';
import { useSigninReminderSettings } from '../../hooks/admin/use-signin-reminder-settings';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

/**
 * ROK-2284: Admin → Discord → Features "Sign-in reminders" card. The switch
 * saves at once (design-system: a Switch applies immediately); the two number
 * fields save together with Save. Out-of-range input is an inline Field error
 * and is never sent; the API re-validates. Toasts only for save outcomes.
 */
type Bounds = { readonly min: number; readonly max: number };

const rangeError = (b: Bounds) => `Enter a whole number from ${b.min} to ${b.max}.`;

/** A whole number inside `b`, or null when the draft is out of range. */
function parseInRange(value: string, b: Bounds): number | null {
    if (!/^\d+$/.test(value.trim())) return null;
    const n = Number(value.trim());
    return n >= b.min && n <= b.max ? n : null;
}

interface Errors { weeks?: string | undefined; max?: string | undefined }

/** `null` = follow the server value; a string = the admin's in-progress edit. */
function useDraft(serverValue: number | undefined) {
    const [draft, setDraft] = useState<string | null>(null);
    const value = draft ?? (serverValue != null ? String(serverValue) : '');
    return { value, setDraft };
}

function validate(weeks: string, max: string) {
    const w = parseInRange(weeks, SIGNIN_REMINDER_WEEKS_BOUNDS);
    const m = parseInRange(max, SIGNIN_REMINDER_MAX_BOUNDS);
    const errors: Errors = {
        weeks: w === null ? rangeError(SIGNIN_REMINDER_WEEKS_BOUNDS) : undefined,
        max: m === null ? rangeError(SIGNIN_REMINDER_MAX_BOUNDS) : undefined,
    };
    return w !== null && m !== null ? { ok: true as const, weeks: w, max: m } : { ok: false as const, errors };
}

/** Drafts, inline errors and the two save paths (switch, numbers). */
function useSigninReminderForm() {
    const { signinReminder, updateSigninReminder } = useSigninReminderSettings();
    const server = signinReminder.data;
    const weeks = useDraft(server?.weeks);
    const max = useDraft(server?.max);
    const [errors, setErrors] = useState<Errors>({});

    const save = async (next: SigninReminderSettingsDto, success: string) => {
        try {
            await updateSigninReminder.mutateAsync(next);
            toast.success(success);
            return true;
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save sign-in reminder settings.');
            return false;
        }
    };
    const onToggle = (enabled: boolean) => {
        if (!server) return;
        void save({ ...server, enabled }, enabled ? 'Sign-in reminders turned on.' : 'Sign-in reminders turned off.');
    };
    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!server) return;
        const result = validate(weeks.value, max.value);
        if (!result.ok) return setErrors(result.errors);
        if (await save({ enabled: server.enabled, weeks: result.weeks, max: result.max }, 'Sign-in reminder settings saved.')) {
            weeks.setDraft(null);
            max.setDraft(null);
        }
    };
    const onWeeks = (v: string) => { weeks.setDraft(v); setErrors((p) => ({ ...p, weeks: undefined })); };
    const onMax = (v: string) => { max.setDraft(v); setErrors((p) => ({ ...p, max: undefined })); };
    const loadFailed = signinReminder.isError && server == null;
    return {
        isLoading: signinReminder.isLoading, loadFailed, isPending: updateSigninReminder.isPending,
        enabled: server?.enabled ?? false, weeks: weeks.value, max: max.value, errors, onToggle, onSubmit, onWeeks, onMax,
    };
}

export function SigninReminderSettingsForm() {
    const f = useSigninReminderForm();
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-4" data-testid="signin-reminder-section">
            <CardHeader enabled={f.enabled} disabled={f.isLoading || f.loadFailed || f.isPending} onToggle={f.onToggle} />
            {f.isLoading || f.loadFailed ? (
                <LoadState isLoading={f.isLoading} />
            ) : (
                <form onSubmit={f.onSubmit} className="space-y-3" noValidate>
                    <div className="flex flex-wrap gap-4">
                        <NumberField id="signin-reminder-weeks" label="Remind every (weeks)" bounds={SIGNIN_REMINDER_WEEKS_BOUNDS}
                            hint="Weeks between reminders to the same member. 1–12, default 3."
                            value={f.weeks} error={f.errors.weeks} onChange={f.onWeeks} />
                        <NumberField id="signin-reminder-max" label="At most (reminders)" bounds={SIGNIN_REMINDER_MAX_BOUNDS}
                            hint="Reminders a member gets in total. 1–10, default 3."
                            value={f.max} error={f.errors.max} onChange={f.onMax} />
                    </div>
                    <Button type="submit" loading={f.isPending} loadingLabel="Saving…">Save</Button>
                </form>
            )}
        </section>
    );
}

function CardHeader({ enabled, disabled, onToggle }: { enabled: boolean; disabled: boolean; onToggle: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <h3 className="text-base font-semibold text-foreground">Sign-in reminders</h3>
                <p id="signin-reminder-help" className="text-sm text-muted mt-1">
                    The bot DMs server members who have never signed in to Raid Ledger and tells them to type /login.
                    Each DM has a &ldquo;Don&apos;t remind me again&rdquo; button.
                </p>
            </div>
            <Switch label="Remind members who haven't signed in" checked={enabled} disabled={disabled}
                onChange={onToggle} aria-describedby="signin-reminder-help" />
        </div>
    );
}

/** Placeholder while the settings load, or the load-failed message. */
function LoadState({ isLoading }: { isLoading: boolean }) {
    if (isLoading) return <p className="text-sm text-dim">Loading sign-in reminder settings…</p>;
    return <p role="alert" className="text-sm text-danger">Couldn&apos;t load sign-in reminder settings. Reload the page to try again.</p>;
}

function NumberField({ id, label, hint, bounds, value, error, onChange }: {
    id: string; label: string; hint: string; bounds: Bounds;
    value: string; error: string | undefined; onChange: (v: string) => void;
}) {
    return (
        <Field id={id} label={label} hint={hint} error={error} className="w-full sm:w-64">
            {/* A wrapper sizes the control: Input's own frame is w-full. */}
            <div className="w-32">
                <Input type="number" min={bounds.min} max={bounds.max} step={1} value={value}
                    onChange={(e) => onChange(e.target.value)} />
            </div>
        </Field>
    );
}
