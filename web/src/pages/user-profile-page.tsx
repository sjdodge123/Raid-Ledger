import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { useUserProfile, useUserHeartedGames } from '../hooks/use-user-profile';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useBranding } from '../hooks/use-branding';
import { formatDistanceToNow } from 'date-fns';
import type { CharacterDto, UserHeartedGameDto } from '@raid-ledger/contract';
import { resolveAvatar, toAvatarUser, buildDiscordAvatarUrl } from '../lib/avatar';
import { UserEventSignups } from '../components/profile/UserEventSignups';
import './user-profile-page.css';

const FACTION_STYLES: Record<string, string> = {
    alliance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    horde: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const ROLE_COLORS: Record<string, string> = {
    tank: 'bg-blue-600',
    healer: 'bg-emerald-600',
    dps: 'bg-red-600',
};

/** Read-only character card matching the profile page style, clickable to detail page */
function PublicCharacterCard({ character }: { character: CharacterDto }) {
    return (
        <Link
            to={`/characters/${character.id}`}
            className="bg-panel border border-edge rounded-lg p-4 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
        >
            {character.avatarUrl ? (
                <img
                    src={character.avatarUrl}
                    alt={character.name}
                    className="w-10 h-10 rounded-full bg-overlay flex-shrink-0"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            ) : (
                <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-muted flex-shrink-0">
                    👤
                </div>
            )}
            <div className="min-w-0 overflow-hidden">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground truncate max-w-[180px] sm:max-w-none">{character.name}</span>
                    {character.faction && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium border flex-shrink-0 ${FACTION_STYLES[character.faction] ?? 'bg-faint text-muted'}`}>
                            {character.faction.charAt(0).toUpperCase() + character.faction.slice(1)}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 text-sm text-muted flex-wrap">
                    {character.level && (
                        <>
                            <span className="text-amber-400">Lv.{character.level}</span>
                            <span>•</span>
                        </>
                    )}
                    {character.race && <span className="truncate max-w-[100px] sm:max-w-none">{character.race}</span>}
                    {character.race && character.class && <span>•</span>}
                    {character.class && <span className="truncate max-w-[100px] sm:max-w-none">{character.class}</span>}
                    {character.spec && <span className="truncate max-w-[80px] sm:max-w-none">• {character.spec}</span>}
                    {character.effectiveRole && (
                        <span className={`px-1.5 py-0.5 rounded text-xs text-foreground flex-shrink-0 ${ROLE_COLORS[character.effectiveRole] ?? 'bg-faint'}`}>
                            {character.effectiveRole.toUpperCase()}
                        </span>
                    )}
                    {character.itemLevel && (
                        <>
                            <span>•</span>
                            <span className="text-purple-400 whitespace-nowrap">{character.itemLevel} iLvl</span>
                        </>
                    )}
                </div>
            </div>
        </Link>
    );
}

/** Clickable game card for the hearted games section (ROK-282) */
function HeartedGameCard({ game }: { game: UserHeartedGameDto }) {
    return (
        <Link
            to={`/games/${game.id}`}
            className="bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
        >
            {game.coverUrl ? (
                <img
                    src={game.coverUrl}
                    alt={game.name}
                    className="w-10 h-14 rounded object-cover flex-shrink-0"
                    loading="lazy"
                />
            ) : (
                <div className="w-10 h-14 rounded bg-overlay flex items-center justify-center text-muted flex-shrink-0 text-xs">
                    ?
                </div>
            )}
            <span className="font-medium text-foreground truncate">{game.name}</span>
        </Link>
    );
}

/** Characters grouped by game, matching the My Characters page pattern (ROK-308) */
function GroupedCharacters({
    characters,
    games,
}: {
    characters: CharacterDto[];
    games: { id: number; name: string }[];
}) {
    const gameNameMap = new Map(games.map((g) => [g.id, g.name]));

    const grouped = characters.reduce(
        (acc, char) => {
            const game = char.gameId;
            if (!acc[game]) acc[game] = [];
            acc[game].push(char);
            return acc;
        },
        {} as Record<string, CharacterDto[]>,
    );

    Object.values(grouped).forEach((chars) => {
        chars.sort((a, b) => {
            if (a.isMain && !b.isMain) return -1;
            if (!a.isMain && b.isMain) return 1;
            return a.displayOrder - b.displayOrder;
        });
    });

    return (
        <div className="user-profile-section">
            <h2 className="user-profile-section-title">
                Characters ({characters.length})
            </h2>
            <div className="space-y-6">
                {Object.entries(grouped).map(([gameId, chars]) => {
                    const gameName = gameNameMap.get(Number(gameId)) ?? 'Unknown Game';
                    return (
                        <div key={gameId}>
                            <div className="flex items-center gap-3 mb-3">
                                <h3 className="text-sm font-semibold text-foreground">
                                    {gameName}
                                </h3>
                                <span className="text-xs text-muted">
                                    {chars.length} character
                                    {chars.length !== 1 ? 's' : ''}
                                </span>
                                <div className="flex-1 border-t border-edge-subtle" />
                            </div>
                            <div className="space-y-2">
                                {chars.map((character) => (
                                    <PublicCharacterCard
                                        key={character.id}
                                        character={character}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** Route state passed when navigating to a guest (PUG) user profile (ROK-381). */
interface GuestRouteState {
    guest: true;
    username: string;
    discordId: string;
    avatarHash: string | null;
}

function isGuestRouteState(state: unknown): state is GuestRouteState {
    return (
        state != null &&
        typeof state === 'object' &&
        (state as Record<string, unknown>).guest === true &&
        typeof (state as Record<string, unknown>).username === 'string'
    );
}

/**
 * Guest profile page for non-member Discord users (ROK-381).
 * Shown when navigating to a user profile via a PUG roster slot.
 */
function GuestProfile({ username, discordId, avatarHash }: Omit<GuestRouteState, 'guest'>) {
    const navigate = useNavigate();
    const { brandingQuery } = useBranding();
    const communityName = brandingQuery.data?.communityName ?? 'this community';
    const avatarUrl = buildDiscordAvatarUrl(discordId, avatarHash);

    return (
        <div className="user-profile-page">
            <div className="user-profile-card">
                <div className="user-profile-header">
                    {avatarUrl ? (
                        <img
                            src={avatarUrl}
                            alt={username}
                            className="user-profile-avatar"
                            onError={(e) => {
                                e.currentTarget.style.display = 'none';
                            }}
                        />
                    ) : (
                        <div className="user-profile-avatar user-profile-avatar--initials">
                            {username.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <div className="user-profile-info">
                        <h1 className="user-profile-name">{username}</h1>
                        <p className="user-profile-meta">
                            {username} is not currently a member of {communityName}
                        </p>
                        <p className="user-profile-guest-note">
                            This player was added as a guest via Discord
                        </p>
                    </div>
                </div>

                <div className="user-profile-guest-actions">
                    <button
                        onClick={() => navigate(-1)}
                        className="btn btn-primary"
                    >
                        Back
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Public user profile page (ROK-181).
 * Shows username, avatar, member since, and characters.
 */
export function UserProfilePage() {
    const { userId } = useParams<{ userId: string }>();
    const numericId = userId ? parseInt(userId, 10) : undefined;
    const location = useLocation();

    const { data: profile, isLoading, error } = useUserProfile(numericId);
    const { data: heartedGamesData } = useUserHeartedGames(numericId);
    const heartedGames = heartedGamesData?.data ?? [];
    const { games } = useGameRegistry();

    if (isLoading) {
        return (
            <div className="user-profile-page">
                <div className="user-profile-skeleton">
                    <div className="skeleton skeleton-avatar" />
                    <div className="skeleton skeleton-text skeleton-text--lg" />
                    <div className="skeleton skeleton-text skeleton-text--sm" />
                </div>
            </div>
        );
    }

    if (error || !profile) {
        // ROK-381: Show guest profile when route state indicates a PUG user
        const guestState = location.state as unknown;
        if (isGuestRouteState(guestState)) {
            return (
                <GuestProfile
                    username={guestState.username}
                    discordId={guestState.discordId}
                    avatarHash={guestState.avatarHash}
                />
            );
        }

        return (
            <div className="user-profile-page">
                <div className="user-profile-error">
                    <h2>User Not Found</h2>
                    <p>The user you're looking for doesn't exist or has been removed.</p>
                    <Link to="/calendar" className="btn btn-primary">
                        Back to Calendar
                    </Link>
                </div>
            </div>
        );
    }

    const memberSince = formatDistanceToNow(new Date(profile.createdAt), { addSuffix: true });

    // ROK-222: Use toAvatarUser for unified avatar resolution
    const profileAvatar = resolveAvatar(toAvatarUser(profile));

    return (
        <div className="user-profile-page">
            <div className="user-profile-card">
                {/* Header */}
                <div className="user-profile-header">
                    {profileAvatar.url ? (
                        <img
                            src={profileAvatar.url}
                            alt={profile.username}
                            className="user-profile-avatar"
                            onError={(e) => {
                                e.currentTarget.style.display = 'none';
                            }}
                        />
                    ) : (
                        <div className="user-profile-avatar user-profile-avatar--initials">
                            {profile.username.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <div className="user-profile-info">
                        <h1 className="user-profile-name">{profile.username}</h1>
                        <p className="user-profile-meta">
                            Member {memberSince}
                        </p>
                    </div>
                </div>

                {/* Upcoming Events Section (ROK-299) */}
                {numericId && <UserEventSignups userId={numericId} />}

                {/* Characters Section (ROK-308: grouped by game) */}
                {profile.characters.length > 0 && (
                    <GroupedCharacters characters={profile.characters} games={games} />
                )}

                {/* Hearted Games Section (ROK-282) */}
                {heartedGames.length > 0 && (
                    <div className="user-profile-section">
                        <h2 className="user-profile-section-title">
                            Interested In ({heartedGames.length})
                        </h2>
                        <div className="flex flex-col gap-2">
                            {heartedGames.map((game) => (
                                <HeartedGameCard key={game.id} game={game} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
