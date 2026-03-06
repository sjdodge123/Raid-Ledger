/** Known display titles for core cron jobs */
const JOB_TITLES: Record<string, string> = {
    IgdbService_handleScheduledSync: 'IGDB Game Sync',
    EventReminderService_handleStartingSoonReminders: 'Starting Soon Reminders',
    RelayService_handleHeartbeat: 'Relay Heartbeat',
    VersionCheckService_handleCron: 'Version Check',
};

/** Get a user-friendly display title from the registry name */
export function formatJobName(name: string): string {
    if (JOB_TITLES[name]) return JOB_TITLES[name];

    // Plugin jobs: "blizzard:character-auto-sync" -> "Character Auto Sync"
    if (name.includes(':')) {
        return name
            .split(':')[1]
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // Fallback: "SomeService_handleFoo" -> "Foo"
    return name
        .replace(/^\w+Service_/, '')
        .replace(/^handle/, '')
        .replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Convert a 6-field cron expression to a human-readable description */
export function describeCron(expression: string): string {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 6) return expression;

    const [, min, hour, day, month, weekday] = parts;

    // Every N minutes
    if (hour === '*' && day === '*' && month === '*' && weekday === '*') {
        if (min.startsWith('*/')) {
            const n = parseInt(min.slice(2), 10);
            return n === 1 ? 'Every minute' : `Every ${n} minutes`;
        }
    }

    // Every N hours
    if (min === '0' && day === '*' && month === '*' && weekday === '*') {
        if (hour.startsWith('*/')) {
            const n = parseInt(hour.slice(2), 10);
            return n === 1 ? 'Every hour' : `Every ${n} hours`;
        }
    }

    // Specific hours
    if (min === '0' && day === '*' && month === '*' && weekday === '*' && !hour.includes('/') && !hour.includes('-')) {
        const hours = hour.split(',').map((h) => parseInt(h, 10));
        if (hours.every((h) => !isNaN(h))) {
            const formatHour = (h: number): string => {
                if (h === 0) return '12:00 AM';
                if (h === 12) return '12:00 PM';
                return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
            };
            if (hours.length === 1) return `Daily at ${formatHour(hours[0])}`;
            const labels = hours.map(formatHour);
            return `Daily at ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
        }
    }

    // Specific hour + minute
    if (day === '*' && month === '*' && weekday === '*' && !min.includes('*') && !min.includes('/') && !hour.includes('*') && !hour.includes('/')) {
        const h = parseInt(hour, 10);
        const m = parseInt(min, 10);
        if (!isNaN(h) && !isNaN(m)) {
            const period = h >= 12 ? 'PM' : 'AM';
            const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
            return `Daily at ${displayHour}:${m.toString().padStart(2, '0')} ${period}`;
        }
    }

    // Daily at midnight
    if (min === '0' && hour === '0' && day === '*' && month === '*' && weekday === '*') {
        return 'Daily at midnight';
    }

    // Weekly
    if (min === '0' && hour === '0' && day === '*' && month === '*' && weekday !== '*') {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayIdx = parseInt(weekday, 10);
        if (!isNaN(dayIdx) && dayIdx >= 0 && dayIdx <= 6) {
            return `Weekly on ${dayNames[dayIdx]} at midnight`;
        }
    }

    return expression;
}

/** Normalize cron expressions to match our preset format */
export function normalizeCron(expression: string): string {
    let parts = expression.trim().split(/\s+/);

    if (parts.length === 5) {
        parts = ['0', ...parts];
    }
    if (parts.length !== 6) return expression;

    const [sec, min, hour, day, month, weekday] = parts;

    let normalizedHour = hour;
    const hourRangeMatch = hour.match(/^0-23\/(\d+)$/);
    if (hourRangeMatch) {
        const step = parseInt(hourRangeMatch[1], 10);
        normalizedHour = step === 1 ? '*' : `*/${step}`;
    }

    let normalizedMin = min;
    const minRangeMatch = min.match(/^0-59\/(\d+)$/);
    if (minRangeMatch) {
        const step = parseInt(minRangeMatch[1], 10);
        normalizedMin = step === 1 ? '*' : `*/${step}`;
    }

    // Map specific hour patterns to interval presets
    if (normalizedMin === '0' && day === '*' && month === '*' && weekday === '*') {
        const hourCommaMatch = normalizedHour.match(/^(\d+(?:,\d+)*)$/);
        if (hourCommaMatch) {
            const hours = normalizedHour.split(',').map(Number).sort((a, b) => a - b);
            if (hours.length >= 2) {
                const interval = hours[1] - hours[0];
                const isEvenlySpaced = hours.every((h, i) => i === 0 || h - hours[i - 1] === interval);
                if (isEvenlySpaced && 24 % interval === 0 && hours.length === 24 / interval) {
                    normalizedHour = `*/${interval}`;
                }
            }
        }
    }

    if (normalizedHour === '*' && normalizedMin === '0') {
        return `0 0 * * * *`;
    }

    return [sec, normalizedMin, normalizedHour, day, month, weekday].join(' ');
}

/** Interval presets for the schedule editor */
export const INTERVAL_PRESETS = [
    { label: 'Every 5 minutes', value: '0 */5 * * * *' },
    { label: 'Every 15 minutes', value: '0 */15 * * * *' },
    { label: 'Every 30 minutes', value: '0 */30 * * * *' },
    { label: 'Every hour', value: '0 0 * * * *' },
    { label: 'Every 2 hours', value: '0 0 */2 * * *' },
    { label: 'Every 6 hours', value: '0 0 */6 * * *' },
    { label: 'Every 12 hours', value: '0 0 */12 * * *' },
    { label: 'Every day at midnight', value: '0 0 0 * * *' },
    { label: 'Every week (Sunday midnight)', value: '0 0 0 * * 0' },
];

/** Get a human-readable label for a cron expression */
export function getCronLabel(expression: string): string {
    const normalized = normalizeCron(expression);
    const match = INTERVAL_PRESETS.find(p => p.value === normalized);
    return match ? match.label : describeCron(expression);
}

/** Format a date string in the user's timezone */
export function formatTimestamp(isoString: string | null, tz: string): string {
    if (!isoString) return '\u2014';
    try {
        return new Date(isoString).toLocaleString('en-US', {
            timeZone: tz,
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });
    } catch {
        return new Date(isoString).toLocaleString();
    }
}

/** Format duration in ms to human-readable */
export function formatDuration(ms: number | null): string {
    if (ms === null) return '\u2014';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
}

/** Category colors for cron job badges */
export const THEME_COLORS: Record<string, string> = {
    'Notifications': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    'Data Sync': 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    'Monitoring': 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    'Maintenance': 'bg-green-500/15 text-green-400 border-green-500/30',
    'Events': 'bg-teal-500/15 text-teal-400 border-teal-500/30',
    'Plugin': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    'Other': 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};
