import { useParams, Link } from 'react-router-dom';
import { useUserProfile } from '../hooks/use-user-profile';
import { formatDistanceToNow } from 'date-fns';
import type { CharacterDto } from '@raid-ledger/contract';
import { resolveAvatar } from '../lib/avatar';
import type { AvatarUser } from '../lib/avatar';
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
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{character.name}</span>
                    {character.isMain && (
                        <span className="text-yellow-400" title="Main character">⭐</span>
                    )}
                    {character.faction && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${FACTION_STYLES[character.faction] ?? 'bg-faint text-muted'}`}>
                            {character.faction.charAt(0).toUpperCase() + character.faction.slice(1)}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                    {character.level && (
                        <>
                            <span className="text-amber-400">Lv.{character.level}</span>
                            <span>•</span>
                        </>
                    )}
                    {character.race && <span>{character.race}</span>}
                    {character.race && character.class && <span>•</span>}
                    {character.class && <span>{character.class}</span>}
                    {character.spec && <span>• {character.spec}</span>}
                    {character.effectiveRole && (
                        <span className={`px-1.5 py-0.5 rounded text-xs text-foreground ${ROLE_COLORS[character.effectiveRole] ?? 'bg-faint'}`}>
                            {character.effectiveRole.toUpperCase()}
                        </span>
                    )}
                    {character.itemLevel && (
                        <>
                            <span>•</span>
                            <span className="text-purple-400">{character.itemLevel} iLvl</span>
                        </>
                    )}
                </div>
            </div>
        </Link>
    );
}

/**
 * Public user profile page (ROK-181).
 * Shows username, avatar, member since, and characters.
 */
export function UserProfilePage() {
    const { userId } = useParams<{ userId: string }>();
    const numericId = userId ? parseInt(userId, 10) : undefined;

    const { data: profile, isLoading, error } = useUserProfile(numericId);

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

    // ROK-222: Build AvatarUser from profile data for resolveAvatar()
    const profileAvatarUser: AvatarUser = {
        avatar: profile.avatar,
        customAvatarUrl: (profile as { customAvatarUrl?: string | null }).customAvatarUrl ?? null,
        characters: profile.characters?.map((c) => ({
            gameId: c.gameId,
            avatarUrl: c.avatarUrl,
        })),
    };
    const profileAvatar = resolveAvatar(profileAvatarUser);

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

                {/* Characters Section */}
                {profile.characters.length > 0 && (
                    <div className="user-profile-section">
                        <h2 className="user-profile-section-title">
                            Characters ({profile.characters.length})
                        </h2>
                        <div className="flex flex-col gap-2">
                            {profile.characters.map((char) => (
                                <PublicCharacterCard key={char.id} character={char} />
                            ))}
                        </div>
                    </div>
                )}

                {profile.characters.length === 0 && (
                    <div className="user-profile-empty">
                        <p>No characters added yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
