/** Sentinel value meaning "use the browser's timezone" */
export const TIMEZONE_AUTO = 'auto';

/** Returns the browser's IANA timezone string */
export function getBrowserTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface TimezoneOption {
    id: string;
    label: string;
    group: string;
}

/**
 * Curated list of common IANA timezones grouped by region.
 * Covers major population centers without overwhelming the user.
 */
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
    // Americas
    { id: 'America/New_York', label: 'Eastern Time (New York)', group: 'Americas' },
    { id: 'America/Chicago', label: 'Central Time (Chicago)', group: 'Americas' },
    { id: 'America/Denver', label: 'Mountain Time (Denver)', group: 'Americas' },
    { id: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)', group: 'Americas' },
    { id: 'America/Anchorage', label: 'Alaska (Anchorage)', group: 'Americas' },
    { id: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)', group: 'Americas' },
    { id: 'America/Toronto', label: 'Eastern Time (Toronto)', group: 'Americas' },
    { id: 'America/Sao_Paulo', label: 'Brasilia (São Paulo)', group: 'Americas' },
    { id: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)', group: 'Americas' },
    { id: 'America/Mexico_City', label: 'Mexico City', group: 'Americas' },

    // Europe
    { id: 'Europe/London', label: 'Greenwich / BST (London)', group: 'Europe' },
    { id: 'Europe/Paris', label: 'Central European (Paris)', group: 'Europe' },
    { id: 'Europe/Berlin', label: 'Central European (Berlin)', group: 'Europe' },
    { id: 'Europe/Moscow', label: 'Moscow', group: 'Europe' },
    { id: 'Europe/Istanbul', label: 'Turkey (Istanbul)', group: 'Europe' },

    // Asia & Oceania
    { id: 'Asia/Dubai', label: 'Gulf (Dubai)', group: 'Asia & Oceania' },
    { id: 'Asia/Kolkata', label: 'India (Kolkata)', group: 'Asia & Oceania' },
    { id: 'Asia/Singapore', label: 'Singapore', group: 'Asia & Oceania' },
    { id: 'Asia/Shanghai', label: 'China (Shanghai)', group: 'Asia & Oceania' },
    { id: 'Asia/Tokyo', label: 'Japan (Tokyo)', group: 'Asia & Oceania' },
    { id: 'Asia/Seoul', label: 'Korea (Seoul)', group: 'Asia & Oceania' },
    { id: 'Australia/Sydney', label: 'Eastern Australia (Sydney)', group: 'Asia & Oceania' },
    { id: 'Australia/Perth', label: 'Western Australia (Perth)', group: 'Asia & Oceania' },
    { id: 'Pacific/Auckland', label: 'New Zealand (Auckland)', group: 'Asia & Oceania' },
];

/** Unique group names in display order */
export const TIMEZONE_GROUPS = [...new Set(TIMEZONE_OPTIONS.map((o) => o.group))];
