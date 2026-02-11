import { useState, useEffect } from 'react';
import { useRefreshCharacterFromArmory } from '../../../hooks/use-character-mutations';

interface ProfileCharacterActionsProps {
    characterId: string;
    lastSyncedAt: string | null;
    region: string | null;
    gameVariant: string | null;
}

/**
 * "Refresh from Armory" button for character profile/detail pages.
 * Includes cooldown timer to prevent API spam.
 */
export function ProfileCharacterActions({
    characterId,
    lastSyncedAt,
    region,
    gameVariant,
}: ProfileCharacterActionsProps) {
    const refreshMutation = useRefreshCharacterFromArmory();
    const [cooldownRemaining, setCooldownRemaining] = useState(0);

    useEffect(() => {
        if (!lastSyncedAt) return;
        const lastSync = new Date(lastSyncedAt).getTime();
        const cooldownMs = 5 * 60 * 1000;

        function update() {
            const remaining = Math.max(0, Math.ceil((cooldownMs - (Date.now() - lastSync)) / 1000));
            setCooldownRemaining(remaining);
        }

        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [lastSyncedAt]);

    function handleRefresh() {
        if (cooldownRemaining > 0) return;
        refreshMutation.mutate({
            id: characterId,
            dto: {
                region: (region as 'us' | 'eu' | 'kr' | 'tw') ?? 'us',
                gameVariant: (gameVariant as 'retail' | 'classic_era' | 'classic' | 'classic_anniversary') ?? undefined,
            },
        });
    }

    if (!lastSyncedAt) return null;

    return (
        <button
            onClick={handleRefresh}
            disabled={refreshMutation.isPending || cooldownRemaining > 0}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/50 disabled:text-muted text-foreground rounded transition-colors inline-flex items-center gap-2"
        >
            {refreshMutation.isPending ? (
                <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Refreshing...
                </>
            ) : cooldownRemaining > 0 ? (
                <>Refresh ({Math.floor(cooldownRemaining / 60)}:{String(cooldownRemaining % 60).padStart(2, '0')})</>
            ) : (
                <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh from Armory
                </>
            )}
        </button>
    );
}
