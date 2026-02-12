import type { RosterAssignmentResponse } from '@raid-ledger/contract';
import { AvatarWithFallback } from '../shared/AvatarWithFallback';
import { toAvatarUser } from '../../lib/avatar';
import type { AvatarUser } from '../../lib/avatar';

interface RosterCardProps {
    item: RosterAssignmentResponse;
    /** Optional: admin remove button handler */
    onRemove?: () => void;
}

/**
 * RosterCard - Static display card for a user in the roster (ROK-208).
 * Simplified from dnd-kit sortable to pure display.
 */
export function RosterCard({ item, onRemove }: RosterCardProps) {
    // Role badge colors
    const roleBadge = item.character?.role ? (
        <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${item.character.role === 'tank'
                ? 'bg-blue-600/30 text-blue-300'
                : item.character.role === 'healer'
                    ? 'bg-green-600/30 text-green-300'
                    : 'bg-red-600/30 text-red-300'
                }`}
        >
            {item.character.role.charAt(0).toUpperCase() + item.character.role.slice(1)}
        </span>
    ) : null;

    return (
        <div
            className="flex items-center gap-3 rounded-lg border border-edge bg-panel/50 p-2 transition-all"
        >
            {/* Avatar - ROK-222: Use resolveAvatar via AvatarWithFallback user prop */}
            <AvatarWithFallback
                user={(() => {
                    const base = toAvatarUser({
                        avatar: item.avatar,
                        discordId: item.discordId,
                        customAvatarUrl: item.customAvatarUrl,
                    });
                    // If there's a character portrait, include it so resolveAvatar can pick it up
                    if (item.character?.avatarUrl) {
                        return {
                            ...base,
                            characters: [{ gameId: '__roster__', avatarUrl: item.character.avatarUrl }],
                        } satisfies AvatarUser;
                    }
                    return base;
                })()}
                gameId={item.character?.avatarUrl ? '__roster__' : undefined}
                username={item.username}
            />

            {/* Info */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{item.username}</span>
                    {roleBadge}
                </div>
                {item.character && (
                    <p className="truncate text-xs text-muted">
                        {item.character.name}
                        {item.character.className && ` • ${item.character.className}`}
                    </p>
                )}
            </div>

            {/* Quick remove button for admins */}
            {onRemove && (
                <button
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    className="rounded p-1 text-dim hover:bg-red-500/20 hover:text-red-400 transition-colors"
                    aria-label={`Remove ${item.username} from slot`}
                    title="Remove from slot"
                >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}
        </div>
    );
}
