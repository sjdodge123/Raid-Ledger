import { useParams, Link } from 'react-router-dom';
import { useUserProfile } from '../hooks/use-user-profile';
import { formatDistanceToNow } from 'date-fns';
import './user-profile-page.css';

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

    // Group characters by game
    const charactersByGame = profile.characters.reduce((acc, char) => {
        const gameId = char.gameId;
        if (!acc[gameId]) {
            acc[gameId] = [];
        }
        acc[gameId].push(char);
        return acc;
    }, {} as Record<string, typeof profile.characters>);

    return (
        <div className="user-profile-page">
            <div className="user-profile-card">
                {/* Header */}
                <div className="user-profile-header">
                    <img
                        src={profile.avatar || '/default-avatar.svg'}
                        alt={profile.username}
                        className="user-profile-avatar"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = '/default-avatar.svg';
                        }}
                    />
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
                        <div className="user-profile-characters">
                            {Object.entries(charactersByGame).map(([gameId, chars]) => (
                                <div key={gameId} className="character-game-group">
                                    {chars.map((char) => (
                                        <div key={char.id} className="character-card">
                                            {char.avatarUrl && (
                                                <img
                                                    src={char.avatarUrl}
                                                    alt=""
                                                    className="character-card-avatar"
                                                />
                                            )}
                                            <div className="character-card-info">
                                                <span className="character-card-name">
                                                    {char.name}
                                                    {char.isMain && (
                                                        <span className="character-card-main">Main</span>
                                                    )}
                                                </span>
                                                {char.class && (
                                                    <span className="character-card-class">
                                                        {char.class}
                                                        {char.spec && ` (${char.spec})`}
                                                    </span>
                                                )}
                                                {char.realm && (
                                                    <span className="character-card-realm">{char.realm}</span>
                                                )}
                                            </div>
                                            {char.role && (
                                                <span className={`character-card-role role-${char.role}`}>
                                                    {char.role}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
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
