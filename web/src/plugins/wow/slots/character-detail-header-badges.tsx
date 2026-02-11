const FACTION_STYLES: Record<string, string> = {
    alliance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    horde: 'bg-red-500/20 text-red-400 border-red-500/30',
};

interface CharacterDetailHeaderBadgesProps {
    faction: string | null;
    itemLevel: number | null;
    equippedItemLevel: number | null;
    lastSyncedAt: string | null;
    profileUrl: string | null;
}

export function CharacterDetailHeaderBadges({
    faction,
    itemLevel,
    equippedItemLevel,
    lastSyncedAt,
    profileUrl,
}: CharacterDetailHeaderBadgesProps) {
    return (
        <>
            {faction && (
                <span className={`px-2 py-0.5 rounded text-sm font-medium border ${FACTION_STYLES[faction] ?? 'bg-faint text-muted'}`}>
                    {faction.charAt(0).toUpperCase() + faction.slice(1)}
                </span>
            )}
            {itemLevel && (
                <div className="text-sm">
                    <span className="text-muted">Item Level </span>
                    <span className="text-purple-400 font-semibold text-lg">{itemLevel}</span>
                </div>
            )}
            {equippedItemLevel && equippedItemLevel !== itemLevel && (
                <div className="text-sm">
                    <span className="text-muted">Equipped </span>
                    <span className="text-purple-300 font-semibold">{equippedItemLevel}</span>
                </div>
            )}
            {profileUrl && (
                <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                    View on Armory
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                </a>
            )}
            {lastSyncedAt && (
                <span className="text-xs text-muted">
                    Updated {timeAgo(lastSyncedAt)}
                </span>
            )}
        </>
    );
}

function timeAgo(dateString: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
