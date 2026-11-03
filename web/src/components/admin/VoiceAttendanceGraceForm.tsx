import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useVoiceAttendanceSettings } from '../../hooks/admin/use-voice-attendance-settings';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';

/**
 * ROK-1940: Admin → Discord → Features "Voice attendance" card — the grace
 * window (0–60 min) after an event's start before a first voice join counts
 * as late. Out-of-range input is an inline Field error and is never sent;
 * the API re-validates. Toasts only for save success/failure.
 */
const RANGE_ERROR = 'Enter a whole number from 0 to 60.';

/** A whole number 0–60, or null when the draft is out of range. */
function parseGrace(value: string): number | null {
    if (!/^\d+$/.test(value.trim())) return null;
    const n = Number(value.trim());
    return n <= 60 ? n : null;
}

/** Draft + inline error + save handler for the grace field. */
function useGraceForm() {
    const { voiceAttendance, updateVoiceAttendance } = useVoiceAttendanceSettings();
    // `null` = follow the server value; a string = the user's in-progress edit.
    const [draft, setDraft] = useState<string | null>(null);
    const [error, setError] = useState<string | undefined>(undefined);
    const serverValue = voiceAttendance.data?.graceMinutes;
    const value = draft ?? (serverValue != null ? String(serverValue) : '');
    const onChange = (v: string) => { setDraft(v); setError(undefined); };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const grace = parseGrace(value);
        if (grace === null) return setError(RANGE_ERROR);
        try {
            await updateVoiceAttendance.mutateAsync(grace);
            setDraft(null);
            toast.success('Voice attendance grace saved.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save voice attendance grace.');
        }
    };
    return { isLoading: voiceAttendance.isLoading, isPending: updateVoiceAttendance.isPending, value, error, onChange, handleSave };
}

export function VoiceAttendanceGraceForm() {
    const { isLoading, isPending, value, error, onChange, handleSave } = useGraceForm();
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-4" data-testid="voice-attendance-section">
            <div>
                <h3 className="text-base font-semibold text-foreground">Voice attendance</h3>
                <p className="text-sm text-muted mt-1">
                    After an event ends, Raid Ledger marks each signed-up player from their time in the event&apos;s voice channel.
                </p>
            </div>
            {isLoading ? (
                <p className="text-sm text-dim">Loading voice attendance settings…</p>
            ) : (
                <form onSubmit={handleSave} className="space-y-3" noValidate>
                    <GraceField value={value} error={error} onChange={onChange} />
                    <Button type="submit" loading={isPending} loadingLabel="Saving…">
                        Save
                    </Button>
                </form>
            )}
        </section>
    );
}

function GraceField({ value, error, onChange }: {
    value: string; error: string | undefined; onChange: (v: string) => void;
}) {
    return (
        <Field
            id="voice-grace-minutes"
            label="Late after (minutes)"
            hint="Joining voice more than this many minutes after the start counts as late. 0–60, default 5. Applies to events that end after you save."
            error={error}
        >
            {/* A wrapper sizes the control: Input's own frame is w-full. */}
            <div className="w-32">
                <Input type="number" min={0} max={60} step={1} value={value} onChange={(e) => onChange(e.target.value)} />
            </div>
        </Field>
    );
}
