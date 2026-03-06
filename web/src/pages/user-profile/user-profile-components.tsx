import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CharacterDto, UserHeartedGameDto, ActivityPeriod, GameActivityEntryDto } from '@raid-ledger/contract';
import { formatPlaytime, PERIOD_LABELS } from '../../lib/activity-utils';
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

/** Characters grouped by game, matching the My Characters page pattern (ROK-308) */
// eslint-disable-next-line max-lines-per-function
export function GroupedCharacters({ characters, games }: {
    characters: CharacterDto[];
    games: { id: number; name: string }[];
}): JSX.Element {
    const gameNameMap = new Map(games.map((g) => [g.id, g.name]));
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

    return (
        <div className="user-profile-section">
            <h2 className="user-profile-section-title">Characters ({characters.length})</h2>
            <div className="space-y-6">
                {Object.entries(grouped).map(([gameId, chars]) => {
                    const gameName = gameNameMap.get(Number(gameId)) ?? 'Unknown Game';
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
                })}
            </div>
        </div>
    );
}

/** ROK-443: Game activity section for user profiles */
// eslint-disable-next-line max-lines-per-function
export function ActivitySection({ userId, isOwnProfile }: {
    userId: number; isOwnProfile: boolean;
}): JSX.Element {
    const [period, setPeriod] = useState<ActivityPeriod>('week');
    const { data, isLoading } = useUserActivity(userId, period);
    const entries = data?.data ?? [];
    const queryClient = useQueryClient();

    const { data: prefs } = useQuery({
        queryKey: ['user-preferences'],
        queryFn: getMyPreferences,
        enabled: isOwnProfile,
        staleTime: Infinity,
    });

    const privacyMutation = useMutation({
        mutationFn: (value: boolean) => updatePreference('show_activity', value),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-preferences'] }); },
    });

    const showActivity = prefs?.show_activity !== false;

    return (
        <div className="user-profile-section">
            <div className="flex items-center justify-between mb-3">
                <h2 className="user-profile-section-title mb-0">Game Activity</h2>
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
            </div>

            <ActivityContent entries={entries} isLoading={isLoading} />

            {isOwnProfile && (
                <ActivityPrivacyToggle showActivity={showActivity} onToggle={(v) => privacyMutation.mutate(v)} isPending={privacyMutation.isPending} />
            )}
        </div>
    );
}

/** Activity entries list or loading/empty states */
// eslint-disable-next-line max-lines-per-function
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
            {entries.map((entry) => (
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
            ))}
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

/** Route state passed when navigating to a guest (PUG) user profile (ROK-381). */
export interface GuestRouteState {
    guest: true;
    username: string;
    discordId: string;
    avatarHash: string | null;
}

/** Type guard for guest route state */
export function isGuestRouteState(state: unknown): state is GuestRouteState {
    return (
        state != null &&
        typeof state === 'object' &&
        (state as Record<string, unknown>).guest === true &&
        typeof (state as Record<string, unknown>).username === 'string'
    );
}

/** Guest profile page for non-member Discord users (ROK-381). */
export function GuestProfile({ username, discordId, avatarHash }: Omit<GuestRouteState, 'guest'>): JSX.Element {
    const navigate = useNavigate();
    const { brandingQuery } = useBranding();
    const communityName = brandingQuery.data?.communityName ?? 'this community';
    const avatarUrl = buildDiscordAvatarUrl(discordId, avatarHash);

    return (
        <div className="user-profile-page">
            <div className="user-profile-card">
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
                <div className="user-profile-guest-actions">
                    <button onClick={() => navigate(-1)} className="btn btn-primary">Back</button>
                </div>
            </div>
        </div>
    );
}
