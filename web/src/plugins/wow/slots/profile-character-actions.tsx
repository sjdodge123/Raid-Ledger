import { useState, useEffect } from 'react';
import { useRefreshCharacterFromArmory } from '../hooks/use-wow-mutations';

interface ProfileCharacterActionsProps {
    characterId: string;
    lastSyncedAt: string | null;
    region: string | null;
    gameVariant: string | null;
    profileUrl: string | null;
}

function useRefreshCooldown(lastSyncedAt: string | null) {
    const [cooldownRemaining, setCooldownRemaining] = useState(0);
    useEffect(() => {
        if (!lastSyncedAt) return;
        const lastSync = new Date(lastSyncedAt).getTime();
        const cooldownMs = 5 * 60 * 1000;
        function update() {
            setCooldownRemaining(Math.max(0, Math.ceil((cooldownMs - (Date.now() - lastSync)) / 1000)));
        }
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [lastSyncedAt]);
    return cooldownRemaining;
}

function formatCooldown(seconds: number): string {
    return `Cooldown: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function RefreshIcon({ isPending }: { isPending: boolean }) {
    if (isPending) {
        return (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
        );
    }
    return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
    );
}

function RefreshButton({ characterId, region, gameVariant, cooldownRemaining }: {
    characterId: string; region: string | null; gameVariant: string | null; cooldownRemaining: number;
}) {
    const refreshMutation = useRefreshCharacterFromArmory();
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
    return (
        <button onClick={handleRefresh} disabled={refreshMutation.isPending || cooldownRemaining > 0}
            className="px-2 py-1.5 text-sm text-blue-400 hover:text-blue-300 hover:bg-blue-950/50 disabled:text-muted disabled:hover:bg-transparent rounded transition-colors"
            title={cooldownRemaining > 0 ? formatCooldown(cooldownRemaining) : 'Refresh from Armory'}>
            <RefreshIcon isPending={refreshMutation.isPending} />
        </button>
    );
}

function ArmoryLink({ profileUrl }: { profileUrl: string }) {
    return (
        <a href={profileUrl} target="_blank" rel="noopener noreferrer"
            className="px-2 py-1.5 text-muted hover:text-blue-400 transition-colors"
            title="View on Blizzard Armory" onClick={(e) => e.stopPropagation()}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
        </a>
    );
}

/**
 * "Refresh from Armory" button + external armory link for character profile/detail pages.
 * Includes cooldown timer to prevent API spam.
 */
export function ProfileCharacterActions({
    characterId, lastSyncedAt, region, gameVariant, profileUrl,
}: ProfileCharacterActionsProps) {
    const cooldownRemaining = useRefreshCooldown(lastSyncedAt);
    return (
        <>
            {!!lastSyncedAt && <RefreshButton characterId={characterId} region={region} gameVariant={gameVariant} cooldownRemaining={cooldownRemaining} />}
            {profileUrl && <ArmoryLink profileUrl={profileUrl} />}
        </>
    );
}
