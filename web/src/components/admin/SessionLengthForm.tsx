import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useSessionLength } from '../../hooks/admin/use-session-length';

/**
 * ROK-1353: admin control for the refresh-token session length (days).
 * Mirrors the DiscordOAuthForm states (loading, saved, error). Range 1–365;
 * the API re-validates, so an out-of-range value is rejected server-side too.
 */
/** Validate (1–365) + persist, surfacing toasts. Returns true on success. */
async function saveSessionLength(
    days: string,
    mutate: (n: number) => Promise<unknown>,
): Promise<boolean> {
    const parsed = Number.parseInt(days, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
        toast.error('Session length must be a whole number between 1 and 365.');
        return false;
    }
    try {
        await mutate(parsed);
        toast.success('Session length saved.');
        return true;
    } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save session length.');
        return false;
    }
}

export function SessionLengthForm() {
    const { sessionLength, updateSessionLength } = useSessionLength();
    // `null` = follow the server value; a string = the user's in-progress edit.
    const [draft, setDraft] = useState<string | null>(null);
    const serverDays = sessionLength.data?.sessionLengthDays;
    const days = draft ?? (serverDays != null ? String(serverDays) : '');

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const ok = await saveSessionLength(days, updateSessionLength.mutateAsync);
        if (ok) setDraft(null);
    };

    if (sessionLength.isLoading) {
        return <p className="text-sm text-dim">Loading session settings…</p>;
    }

    return (
        <form onSubmit={handleSave} className="space-y-3">
            <SessionLengthField value={days} onChange={setDraft} />
            <button
                type="submit"
                disabled={updateSessionLength.isPending}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
                {updateSessionLength.isPending ? 'Saving…' : 'Save'}
            </button>
        </form>
    );
}

function SessionLengthField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label htmlFor="session-length-days" className="block text-sm font-medium text-secondary mb-1.5">
                Session length (days)
            </label>
            <input
                id="session-length-days"
                type="number"
                min={1}
                max={365}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-32 rounded-md border border-edge bg-surface px-3 py-2 text-sm text-foreground"
            />
            <p className="text-xs text-dim mt-1.5">
                How long a signed-in session stays valid before re-login (default 60).
            </p>
        </div>
    );
}
