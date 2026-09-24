import { useSystemStatus } from '../../hooks/use-system-status';
import { Checkbox } from '../ui/checkbox';

/**
 * Nested "Private — only rostered members can join" checkbox (ROK-1386).
 * Extracted so the parent toggle stays under the max-lines-per-function limit.
 * ROK-1649: the shared Checkbox, named by its visible text (ruling 12). The
 * indent lines it up with the parent's label text (20px box + 12px gap).
 */
function PrivateVoiceCheckbox({
    privateValue,
    onPrivateChange,
}: {
    privateValue: boolean | null;
    onPrivateChange: (v: boolean | null) => void;
}) {
    return (
        <div className="ml-8">
            <Checkbox
                label="Private — only rostered members can join"
                checked={privateValue === true}
                onChange={(e) =>
                    onPrivateChange(e.target.checked ? true : null)
                }
            />
        </div>
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
 * ROK-1649: the shared Checkbox, named by its visible label (ruling 12).
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
        <div>
            <Checkbox
                label={
                    forced
                        ? 'A temporary voice channel will be created for this event (enabled by admin)'
                        : 'Create a temporary voice channel for this event'
                }
                checked={effectiveOn}
                disabled={forced}
                onChange={(e) => {
                    const next = e.target.checked ? true : null;
                    onChange(next);
                    // Private only makes sense while ephemeral is on.
                    if (next !== true && !forced) onPrivateChange(null);
                }}
            />
            {effectiveOn && (
                <PrivateVoiceCheckbox
                    privateValue={privateValue}
                    onPrivateChange={onPrivateChange}
                />
            )}
        </div>
    );
}
