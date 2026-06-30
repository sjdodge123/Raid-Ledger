import { useSystemStatus } from '../../hooks/use-system-status';

/**
 * Nested "Private — only rostered members can join" checkbox (ROK-1386).
 * Extracted so the parent toggle stays under the max-lines-per-function limit.
 */
function PrivateVoiceCheckbox({
    privateValue,
    onPrivateChange,
}: {
    privateValue: boolean | null;
    onPrivateChange: (v: boolean | null) => void;
}) {
    return (
        <label className="flex items-center gap-3 cursor-pointer ml-7">
            <input
                type="checkbox"
                aria-label="Private event — only rostered members can join"
                checked={privateValue === true}
                onChange={(e) =>
                    onPrivateChange(e.target.checked ? true : null)
                }
                className="h-4 w-4 rounded border-edge text-emerald-500 focus:ring-emerald-500"
            />
            <span className="text-sm text-foreground">
                Private — only rostered members can join
            </span>
        </label>
    );
}

/**
 * ROK-1352: Per-event ephemeral-voice toggle.
 * ROK-1386: nested "Private — only rostered members can join" checkbox, shown
 * only when ephemeral voice is EFFECTIVELY on (checked or admin-forced).
 *
 * Reads feature availability from the member-readable system status (NOT the
 * admin-only settings API) so non-admin event creators can opt in — and so the
 * create/edit form doesn't fire a burst of 403s for them. Hidden entirely when
 * the global master toggle is off. When the admin has force-ephemeral enabled,
 * every event gets a channel regardless, so the control renders on + disabled
 * with an explanatory label.
 */
export function EphemeralVoiceToggle({
    value,
    onChange,
    privateValue,
    onPrivateChange,
}: {
    value: boolean | null;
    onChange: (v: boolean | null) => void;
    privateValue: boolean | null;
    onPrivateChange: (v: boolean | null) => void;
}) {
    const { data: status } = useSystemStatus();
    if (!status?.ephemeralVoiceEnabled) return null;
    const forced = status.ephemeralVoiceForced === true;
    const effectiveOn = forced || value === true;

    return (
        <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
                <input
                    type="checkbox"
                    aria-label="Ephemeral voice channel for this event"
                    checked={forced || value === true}
                    disabled={forced}
                    onChange={(e) => {
                        const next = e.target.checked ? true : null;
                        onChange(next);
                        // Private only makes sense while ephemeral is on.
                        if (next !== true && !forced) onPrivateChange(null);
                    }}
                    className="h-4 w-4 rounded border-edge text-emerald-500 focus:ring-emerald-500 disabled:opacity-60"
                />
                <span className="text-sm text-foreground">
                    {forced
                        ? 'A temporary voice channel will be created for this event (enabled by admin)'
                        : 'Create a temporary voice channel for this event'}
                </span>
            </label>
            {effectiveOn && (
                <PrivateVoiceCheckbox
                    privateValue={privateValue}
                    onPrivateChange={onPrivateChange}
                />
            )}
        </div>
    );
}
