import { useTimezoneStore } from '../../stores/timezone-store';
import { getTimezoneAbbr } from '../../lib/timezone-utils';
import {
    TIMEZONE_AUTO,
    TIMEZONE_OPTIONS,
    TIMEZONE_GROUPS,
    getBrowserTimezone,
} from '../../constants/timezones';
import { Field } from '../ui/field';
import { Select } from '../ui/select';

/** The section's h2 is the visible caption, so the Field label is visually hidden. */
function TimezoneSelect({ value, onChange, browserAbbr }: { value: string; onChange: (v: string) => void; browserAbbr: string }) {
    return (
        <Field label="Timezone" hideLabel>
            <Select fieldSize="lg" value={value} onChange={(e) => onChange(e.target.value)}>
                <option value={TIMEZONE_AUTO}>Auto — detect from browser ({browserAbbr})</option>
                {TIMEZONE_GROUPS.map((group) => (
                    <optgroup key={group} label={group}>
                        {TIMEZONE_OPTIONS.filter((o) => o.group === group).map((o) => (
                            <option key={o.id} value={o.id}>{o.label} ({getTimezoneAbbr(o.id)})</option>
                        ))}
                    </optgroup>
                ))}
            </Select>
        </Field>
    );
}

export function TimezoneSection() {
    const timezoneId = useTimezoneStore((s) => s.timezoneId);
    const resolved = useTimezoneStore((s) => s.resolved);
    const setTimezone = useTimezoneStore((s) => s.setTimezone);
    const abbr = getTimezoneAbbr(resolved);
    const browserAbbr = getTimezoneAbbr(getBrowserTimezone());

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-1">Timezone</h2>
            <p className="text-sm text-muted mb-4">
                Choose how event times are displayed. Currently showing times in <span className="text-success font-medium">{abbr}</span>
            </p>
            <TimezoneSelect value={timezoneId} onChange={setTimezone} browserAbbr={browserAbbr} />
        </div>
    );
}
