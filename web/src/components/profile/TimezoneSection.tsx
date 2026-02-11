import { useTimezoneStore } from '../../stores/timezone-store';
import { getTimezoneAbbr } from '../../lib/timezone-utils';
import {
    TIMEZONE_AUTO,
    TIMEZONE_OPTIONS,
    TIMEZONE_GROUPS,
    getBrowserTimezone,
} from '../../constants/timezones';

export function TimezoneSection() {
    const timezoneId = useTimezoneStore((s) => s.timezoneId);
    const resolved = useTimezoneStore((s) => s.resolved);
    const setTimezone = useTimezoneStore((s) => s.setTimezone);

    const abbr = getTimezoneAbbr(resolved);
    const browserTz = getBrowserTimezone();
    const browserAbbr = getTimezoneAbbr(browserTz);

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-1">Timezone</h2>
            <p className="text-sm text-muted mb-4">
                Choose how event times are displayed.
                Currently showing times in <span className="text-emerald-400 font-medium">{abbr}</span>
            </p>

            <select
                value={timezoneId}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
            >
                <option value={TIMEZONE_AUTO}>
                    Auto — detect from browser ({browserAbbr})
                </option>

                {TIMEZONE_GROUPS.map((group) => (
                    <optgroup key={group} label={group}>
                        {TIMEZONE_OPTIONS.filter((o) => o.group === group).map((o) => (
                            <option key={o.id} value={o.id}>
                                {o.label} ({getTimezoneAbbr(o.id)})
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </div>
    );
}
