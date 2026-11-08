import { useState, useEffect } from 'react';
import { useRefreshCharacterFromArmory } from '../hooks/use-wow-mutations';
import { safeHttpUrl } from '../../../lib/safe-http-url';
import { Button } from '../../../components/ui/button';
import { ACTION_TILE_CLASS, type CharacterHeaderLayout } from '../../../components/shared/character-header-layout';

interface ProfileCharacterActionsProps {
    characterId: string;
    lastSyncedAt: string | null;
    region: string | null;
    gameVariant: string | null;
    profileUrl: string | null;
    /** ROK-2140: set by the character header — a labelled "Sync" Button (tile on phones); absent = the compact icon (profile card). */
    layout?: CharacterHeaderLayout | undefined;
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

function RefreshButton({ characterId, region, gameVariant, cooldownRemaining, layout }: {
    characterId: string; region: string | null; gameVariant: string | null; cooldownRemaining: number; layout?: CharacterHeaderLayout | undefined;
}) {
    const refreshMutation = useRefreshCharacterFromArmory();
    function handleRefresh() {
        if (cooldownRemaining > 0) return;
        refreshMutation.mutate({
            id: characterId,
            dto: {
                region: (region as 'us' | 'eu' | 'kr' | 'tw') ?? 'us',
                gameVariant: (gameVariant as 'retail' | 'classic_era' | 'classic' | 'classic_anniversary' | 'wow_forever') ?? undefined,
            },
        });
    }
    const disabled = refreshMutation.isPending || cooldownRemaining > 0;
    const title = cooldownRemaining > 0 ? formatCooldown(cooldownRemaining) : 'Sync from Armory';
    if (layout) return <SyncButton layout={layout} disabled={disabled} title={title} isPending={refreshMutation.isPending} onClick={handleRefresh} />;
    return (
        <button onClick={handleRefresh} disabled={disabled}
            className="px-2 py-1.5 text-sm text-blue-400 hover:text-blue-300 hover:bg-blue-950/50 disabled:text-muted disabled:hover:bg-transparent rounded transition-colors"
            title={cooldownRemaining > 0 ? formatCooldown(cooldownRemaining) : 'Refresh from Armory'}>
            <RefreshIcon isPending={refreshMutation.isPending} />
        </button>
    );
}

/** ROK-2140: the character header's labelled "Sync" — a tile on phones, a secondary Button at ≥ sm. */
function SyncButton({ layout, disabled, title, isPending, onClick }: {
    layout: CharacterHeaderLayout; disabled: boolean; title: string; isPending: boolean; onClick: () => void;
}) {
    const phone = layout === 'phone';
    return (
        <Button variant="secondary" size="sm" fullWidth={phone} className={phone ? ACTION_TILE_CLASS : ''} disabled={disabled} title={title} onClick={onClick}>
            <RefreshIcon isPending={isPending} />
            Sync
        </Button>
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
 * "Sync" (refresh from Armory) button + external armory link for character profile/detail pages.
 * Includes cooldown timer to prevent API spam.
 */
export function ProfileCharacterActions({
    characterId, lastSyncedAt, region, gameVariant, profileUrl, layout,
}: ProfileCharacterActionsProps) {
    const cooldownRemaining = useRefreshCooldown(lastSyncedAt);
    const armoryUrl = safeHttpUrl(profileUrl);
    return (
        <>
            {!!lastSyncedAt && <RefreshButton characterId={characterId} region={region} gameVariant={gameVariant} cooldownRemaining={cooldownRemaining} layout={layout} />}
            {armoryUrl && <ArmoryLink profileUrl={armoryUrl} />}
        </>
    );
}
