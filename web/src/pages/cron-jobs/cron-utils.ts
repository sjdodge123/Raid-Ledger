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

function formatHour(h: number): string {
    if (h === 0) return '12:00 AM';
    if (h === 12) return '12:00 PM';
    return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

function describeMinuteInterval(min: string): string | null {
    if (!min.startsWith('*/')) return null;
    const n = parseInt(min.slice(2), 10);
    return n === 1 ? 'Every minute' : `Every ${n} minutes`;
}

function describeHourInterval(hour: string): string | null {
    if (!hour.startsWith('*/')) return null;
    const n = parseInt(hour.slice(2), 10);
    return n === 1 ? 'Every hour' : `Every ${n} hours`;
}

function describeSpecificHours(hour: string): string | null {
    if (hour.includes('/') || hour.includes('-')) return null;
    const hours = hour.split(',').map((h) => parseInt(h, 10));
    if (!hours.every((h) => !isNaN(h))) return null;
    if (hours.length === 1) return `Daily at ${formatHour(hours[0])}`;
    const labels = hours.map(formatHour);
    return `Daily at ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function describeSpecificTime(min: string, hour: string): string | null {
    if (min.includes('*') || min.includes('/') || hour.includes('*') || hour.includes('/')) return null;
    const h = parseInt(hour, 10), m = parseInt(min, 10);
    if (isNaN(h) || isNaN(m)) return null;
    const period = h >= 12 ? 'PM' : 'AM';
    const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${displayHour}:${m.toString().padStart(2, '0')} ${period}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Convert a 6-field cron expression to a human-readable description */
export function describeCron(expression: string): string {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 6) return expression;
    const [, min, hour, day, month, weekday] = parts;
    const isDaily = day === '*' && month === '*' && weekday === '*';

    if (isDaily && hour === '*') { const r = describeMinuteInterval(min); if (r) return r; }
    if (isDaily && min === '0') {
        const r = describeHourInterval(hour) ?? describeSpecificHours(hour); if (r) return r;
        if (hour === '0') return 'Daily at midnight';
    }
    if (isDaily) { const r = describeSpecificTime(min, hour); if (r) return r; }
    if (min === '0' && hour === '0' && day === '*' && month === '*' && weekday !== '*') {
        const dayIdx = parseInt(weekday, 10);
        if (!isNaN(dayIdx) && dayIdx >= 0 && dayIdx <= 6) return `Weekly on ${DAY_NAMES[dayIdx]} at midnight`;
    }
    return expression;
}

function normalizeField(field: string, rangePattern: RegExp): string {
    const match = field.match(rangePattern);
    if (!match) return field;
    const step = parseInt(match[1], 10);
    return step === 1 ? '*' : `*/${step}`;
}

function tryCollapseHourCommas(normalizedHour: string): string {
    const hourCommaMatch = normalizedHour.match(/^(\d+(?:,\d+)*)$/);
    if (!hourCommaMatch) return normalizedHour;
    const hours = normalizedHour.split(',').map(Number).sort((a, b) => a - b);
    if (hours.length < 2) return normalizedHour;
    const interval = hours[1] - hours[0];
    const isEvenlySpaced = hours.every((h, i) => i === 0 || h - hours[i - 1] === interval);
    return isEvenlySpaced && 24 % interval === 0 && hours.length === 24 / interval ? `*/${interval}` : normalizedHour;
}

/** Normalize cron expressions to match our preset format */
export function normalizeCron(expression: string): string {
    let parts = expression.trim().split(/\s+/);
    if (parts.length === 5) parts = ['0', ...parts];
    if (parts.length !== 6) return expression;

    const [sec, min, hour, day, month, weekday] = parts;
    let normalizedHour = normalizeField(hour, /^0-23\/(\d+)$/);
    const normalizedMin = normalizeField(min, /^0-59\/(\d+)$/);

    if (normalizedMin === '0' && day === '*' && month === '*' && weekday === '*') {
        normalizedHour = tryCollapseHourCommas(normalizedHour);
    }
    if (normalizedHour === '*' && normalizedMin === '0') return '0 0 * * * *';
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
