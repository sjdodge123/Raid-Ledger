import { useAdminSettings } from '../../hooks/use-admin-settings';

/**
 * ROK-1352: Per-event ephemeral-voice toggle. Hidden entirely when the global
 * master toggle is off (the feature is inert), so non-admins / disabled
 * installs never see a dead control. Value is tri-state at the API
 * (null = inherit), but the form surfaces a simple on/off override.
 */
export function EphemeralVoiceToggle({
    value,
    onChange,
}: {
    value: boolean | null;
    onChange: (v: boolean | null) => void;
}) {
    const { ephemeralVoiceConfig } = useAdminSettings();
    if (!ephemeralVoiceConfig.data?.enabled) return null;

    return (
        <label className="flex items-center gap-3 cursor-pointer">
            <input
                type="checkbox"
                aria-label="Ephemeral voice channel for this event"
                checked={value === true}
                onChange={(e) => onChange(e.target.checked ? true : null)}
                className="h-4 w-4 rounded border-edge text-emerald-500 focus:ring-emerald-500"
            />
            <span className="text-sm text-foreground">
                Create a temporary voice channel for this event
            </span>
        </label>
    );
}
