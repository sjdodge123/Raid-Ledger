import type { JSX } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CharacterDto, UserHeartedGameDto, ActivityPeriod, GameActivityEntryDto, SteamLibraryEntryDto } from '@raid-ledger/contract';
import type { UseInfiniteListResult } from '../../hooks/use-infinite-list';
import { formatPlaytime, PERIOD_LABELS } from '../../lib/activity-utils';
import { SteamIcon } from '../../components/icons/SteamIcon';
import { buildDiscordAvatarUrl } from '../../lib/avatar';
import { useBranding } from '../../hooks/use-branding';
import { useUserActivity } from '../../hooks/use-user-profile';
import { getMyPreferences, updatePreference } from '../../lib/api-client';
import { CharacterCardCompact } from '../../components/characters/character-card-compact';

/** Clickable game card for the hearted games section (ROK-282) */
export function HeartedGameCard({ game }: { game: UserHeartedGameDto }): JSX.Element {
    return (
        <Link to={`/games/${game.id}`}
            className="bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity">
            {game.coverUrl ? (
                <img src={game.coverUrl} alt={game.name} className="w-10 h-14 rounded object-cover flex-shrink-0" loading="lazy" />
            ) : (
                <div className="w-10 h-14 rounded bg-overlay flex items-center justify-center text-muted flex-shrink-0 text-xs">?</div>
            )}
            <span className="font-medium text-foreground truncate">{game.name}</span>
        </Link>
    );
}

/** Groups characters by game and sorts (main first, then by display order) */
function groupAndSortCharacters(characters: CharacterDto[]): Record<string, CharacterDto[]> {
    const grouped = characters.reduce((acc, char) => {
        const game = char.gameId;
        if (!acc[game]) acc[game] = [];
        acc[game].push(char);
        return acc;
    }, {} as Record<string, CharacterDto[]>);
    Object.values(grouped).forEach((chars) => {
        chars.sort((a, b) => {
            if (a.isMain && !b.isMain) return -1;
            if (!a.isMain && b.isMain) return 1;
            return a.displayOrder - b.displayOrder;
        });
    });
    return grouped;
}

/** Single game group within the characters section */
function GameCharacterGroup({ gameId, gameName, chars }: {
    gameId: string; gameName: string; chars: CharacterDto[];
}): JSX.Element {
    return (
        <div key={gameId}>
            <div className="flex items-center gap-3 mb-3">
                <h3 className="text-sm font-semibold text-foreground">{gameName}</h3>
                <span className="text-xs text-muted">{chars.length} character{chars.length !== 1 ? 's' : ''}</span>
                <div className="flex-1 border-t border-edge-subtle" />
            </div>
            <div className="space-y-2">
                {chars.map((character) => (<CharacterCardCompact key={character.id} character={character} />))}
            </div>
        </div>
    );
}

/** Characters grouped by game, matching the My Characters page pattern (ROK-308) */
export function GroupedCharacters({ characters, games }: {
    characters: CharacterDto[]; games: { id: number; name: string }[];
}): JSX.Element {
    const gameNameMap = new Map(games.map((g) => [g.id, g.name]));
    const grouped = groupAndSortCharacters(characters);
    return (
        <div className="user-profile-section">
            <h2 className="user-profile-section-title">Characters ({characters.length})</h2>
            <div className="space-y-6">
                {Object.entries(grouped).map(([gameId, chars]) => (
                    <GameCharacterGroup key={gameId} gameId={gameId} gameName={gameNameMap.get(Number(gameId)) ?? 'Unknown Game'} chars={chars} />
                ))}
            </div>
        </div>
    );
}

/** Period selector buttons for activity section */
function PeriodSelector({ period, setPeriod }: {
    period: ActivityPeriod; setPeriod: (p: ActivityPeriod) => void;
}): JSX.Element {
    return (
        <div className="flex gap-1">
            {PERIOD_LABELS.map((p) => (
                <button key={p.value} onClick={() => setPeriod(p.value)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                        period === p.value ? 'bg-emerald-600 text-white' : 'bg-overlay text-muted hover:text-foreground'
                    }`}>
                    {p.label}
                </button>
            ))}
        </div>
    );
}

/** Privacy mutation hook for activity visibility */
function useActivityPrivacy(isOwnProfile: boolean): {
    showActivity: boolean; togglePrivacy: (v: boolean) => void; isPending: boolean;
} {
    const queryClient = useQueryClient();
    const { data: prefs } = useQuery({
        queryKey: ['user-preferences'], queryFn: getMyPreferences,
        enabled: isOwnProfile, staleTime: Infinity,
    });
    const privacyMutation = useMutation({
        mutationFn: (value: boolean) => updatePreference('show_activity', value),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-preferences'] }); },
    });
    return {
        showActivity: prefs?.show_activity !== false,
        togglePrivacy: (v) => privacyMutation.mutate(v),
        isPending: privacyMutation.isPending,
    };
}

/** ROK-443: Game activity section for user profiles */
export function ActivitySection({ userId, isOwnProfile }: {
    userId: number; isOwnProfile: boolean;
}): JSX.Element {
    const [period, setPeriod] = useState<ActivityPeriod>('week');
    const { data, isLoading } = useUserActivity(userId, period);
    const entries = data?.data ?? [];
    const privacy = useActivityPrivacy(isOwnProfile);

    return (
        <div className="user-profile-section">
            <div className="flex items-center justify-between mb-3">
                <h2 className="user-profile-section-title mb-0">Game Activity</h2>
                <PeriodSelector period={period} setPeriod={setPeriod} />
            </div>
            <ActivityContent entries={entries} isLoading={isLoading} />
            {isOwnProfile && (
                <ActivityPrivacyToggle showActivity={privacy.showActivity} onToggle={privacy.togglePrivacy} isPending={privacy.isPending} />
            )}
        </div>
    );
}

/** Single activity entry card */
function ActivityEntryCard({ entry }: { entry: GameActivityEntryDto }): JSX.Element {
    return (
        <Link key={entry.gameId} to={`/games/${entry.gameId}`}
            className="bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity">
            {entry.coverUrl ? (
                <img src={entry.coverUrl} alt={entry.gameName} className="w-10 h-14 rounded object-cover flex-shrink-0" loading="lazy" />
            ) : (
                <div className="w-10 h-14 rounded bg-overlay flex items-center justify-center text-muted flex-shrink-0 text-xs">?</div>
            )}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{entry.gameName}</span>
                    {entry.isMostPlayed && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 rounded">Most Played</span>
                    )}
                </div>
                <span className="text-sm text-muted">{formatPlaytime(entry.totalSeconds)}</span>
            </div>
        </Link>
    );
}

/** Activity entries list or loading/empty states */
function ActivityContent({ entries, isLoading }: {
    entries: GameActivityEntryDto[]; isLoading: boolean;
}): JSX.Element {
    if (isLoading) {
        return (
            <div className="space-y-2">
                {[1, 2, 3].map((i) => (<div key={i} className="h-16 bg-overlay rounded-lg animate-pulse" />))}
            </div>
        );
    }
    if (entries.length === 0) return <p className="text-muted text-sm">No activity tracked yet.</p>;
    return (
        <div className="flex flex-col gap-2">
            {entries.map((entry) => (<ActivityEntryCard key={entry.gameId} entry={entry} />))}
        </div>
    );
}

/** Privacy toggle for activity visibility */
function ActivityPrivacyToggle({ showActivity, onToggle, isPending }: {
    showActivity: boolean; onToggle: (v: boolean) => void; isPending: boolean;
}): JSX.Element {
    return (
        <label className="flex items-center gap-3 cursor-pointer mt-4 pt-4 border-t border-edge-subtle">
            <input type="checkbox" checked={showActivity} onChange={(e) => onToggle(e.target.checked)} disabled={isPending}
                className="w-4 h-4 rounded border-edge text-emerald-600 focus:ring-emerald-500" />
            <div>
                <span className="text-sm font-medium text-foreground">Show my game activity publicly</span>
                <p className="text-xs text-muted">When disabled, your activity is hidden from others</p>
            </div>
        </label>
    );
}

/** Guest profile page for non-member Discord users (ROK-381). */
export function GuestProfile({ username, discordId, avatarHash }: { username: string; discordId: string; avatarHash: string | null }): JSX.Element {
    const navigate = useNavigate();
    const { brandingQuery } = useBranding();
    const communityName = brandingQuery.data?.communityName ?? 'this community';
    const avatarUrl = buildDiscordAvatarUrl(discordId, avatarHash);

    return (
        <div className="user-profile-page">
            <div className="user-profile-card">
                <GuestProfileHeader username={username} avatarUrl={avatarUrl} communityName={communityName} />
                <div className="user-profile-guest-actions">
                    <button onClick={() => navigate(-1)} className="btn btn-primary">Back</button>
                </div>
            </div>
        </div>
    );
}

/** Guest profile header with avatar and info */
function GuestProfileHeader({ username, avatarUrl, communityName }: {
    username: string; avatarUrl: string | null; communityName: string;
}): JSX.Element {
    return (
        <div className="user-profile-header">
            {avatarUrl ? (
                <img src={avatarUrl} alt={username} className="user-profile-avatar"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
                <div className="user-profile-avatar user-profile-avatar--initials">{username.charAt(0).toUpperCase()}</div>
            )}
            <div className="user-profile-info">
                <h1 className="user-profile-name">{username}</h1>
                <p className="user-profile-meta">{username} is not currently a member of {communityName}</p>
                <p className="user-profile-guest-note">This player was added as a guest via Discord</p>
            </div>
        </div>
    );
}

/** Single Steam library entry card (ROK-754) */
function SteamLibraryCard({ entry }: { entry: SteamLibraryEntryDto }): JSX.Element {
    return (
        <Link to={`/games/${entry.gameId}`}
            className="bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity">
            {entry.coverUrl ? (
                <img src={entry.coverUrl} alt={entry.gameName} className="w-10 h-14 rounded object-cover flex-shrink-0" loading="lazy" />
            ) : (
                <div className="w-10 h-14 rounded bg-overlay flex items-center justify-center text-muted flex-shrink-0 text-xs">?</div>
            )}
            <div className="flex-1 min-w-0">
                <span className="font-medium text-foreground truncate block">{entry.gameName}</span>
                <span className="text-sm text-muted">{formatPlaytime(entry.playtimeSeconds)}</span>
            </div>
        </Link>
    );
}

/** ROK-754: Steam Library section with infinite scroll */
export function SteamLibrarySection({ steamLibrary }: {
    steamLibrary: UseInfiniteListResult<SteamLibraryEntryDto>;
}): JSX.Element | null {
    if (steamLibrary.items.length === 0 && !steamLibrary.isLoading) return null;
    return (
        <div className="user-profile-section">
            <div className="flex items-center gap-2 mb-3">
                <SteamIcon className="w-5 h-5 text-muted" />
                <h2 className="user-profile-section-title mb-0">
                    Steam Library{steamLibrary.total > 0 ? ` (${steamLibrary.total})` : ''}
                </h2>
            </div>
            <div className="flex flex-col gap-2">
                {steamLibrary.items.map((entry) => (<SteamLibraryCard key={entry.gameId} entry={entry} />))}
            </div>
            {steamLibrary.hasNextPage && <div ref={steamLibrary.sentinelRef} className="h-4" />}
            {steamLibrary.isFetchingNextPage && <p className="text-muted text-sm text-center">Loading more...</p>}
        </div>
    );
}
