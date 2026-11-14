/** A `?date=yyyy-MM-dd` param as a local date, or null when absent or invalid. */
export function parseDateParam(dateStr: string | null): Date | null {
    if (!dateStr) return null;
    const parsed = new Date(dateStr + 'T00:00:00');
    return isNaN(parsed.getTime()) ? null : parsed;
}
