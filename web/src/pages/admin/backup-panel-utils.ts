export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDate(iso: string, tz: string): string {
    return new Date(iso).toLocaleString('en-US', {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

export const TYPE_BADGE: Record<string, string> = {
    daily: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    migration: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};
