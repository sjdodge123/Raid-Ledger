import type { JSX } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useUserProfile, useUserHeartedGames, useUserSteamLibrary } from '../hooks/use-user-profile';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useAuth } from '../hooks/use-auth';
import { formatDistanceToNow } from 'date-fns';
import { resolveAvatar, toAvatarUser } from '../lib/avatar';
import { UserEventSignups } from '../components/profile/UserEventSignups';
import type { UserProfileDto } from '@raid-ledger/contract';
import type { UseInfiniteListResult } from '../hooks/use-infinite-list';
import {
    HeartedGameCard, GroupedCharacters, ActivitySection,
    GuestProfile, SteamLibrarySection,
} from './user-profile/user-profile-components';
import { isGuestRouteState } from './user-profile/user-profile-helpers';
import './user-profile-page.css';

/** Loading skeleton for user profile */
function UserProfileSkeleton(): JSX.Element {
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

/** Error / not-found state with optional guest fallback */
function UserNotFound(): JSX.Element {
    return (
        <div className="user-profile-page">
            <div className="user-profile-error">
                <h2>User Not Found</h2>
                <p>The user you&apos;re looking for doesn&apos;t exist or has been removed.</p>
                <Link to="/calendar" className="btn btn-primary">Back to Calendar</Link>
            </div>
        </div>
    );
}

/** Hearted games list section with infinite scroll (ROK-754) */
function HeartedGamesSection({ hearted }: {
    hearted: UseInfiniteListResult<{ id: number; name: string; igdbId: number | null; slug: string; coverUrl: string | null }>;
}): JSX.Element | null {
    if (hearted.items.length === 0 && !hearted.isLoading) return null;
    return (
        <div className="user-profile-section">
            <h2 className="user-profile-section-title">
                Interested In{hearted.total > 0 ? ` (${hearted.total})` : ''}
            </h2>
            <div className="flex flex-col gap-2">
                {hearted.items.map((game) => (<HeartedGameCard key={game.id} game={game} />))}
            </div>
            {hearted.hasNextPage && <div ref={hearted.sentinelRef} className="h-4" />}
            {hearted.isFetchingNextPage && <p className="text-muted text-sm text-center">Loading more...</p>}
        </div>
    );
}

/** Loaded profile content */
function ProfileContent({ profile, numericId, isOwnProfile, games }: {
    profile: UserProfileDto;
    numericId: number | undefined; isOwnProfile: boolean;
    games: { id: number; name: string }[];
}): JSX.Element {
    const memberSince = formatDistanceToNow(new Date(profile.createdAt), { addSuffix: true });
    const profileAvatar = resolveAvatar(toAvatarUser(profile));
    const hearted = useUserHeartedGames(numericId);
    const steamLibrary = useUserSteamLibrary(numericId);
    return (
        <div className="user-profile-page">
            <div className="user-profile-card">
                <ProfileHeader profile={profile} profileAvatar={profileAvatar} memberSince={memberSince} />
                {numericId && <ActivitySection userId={numericId} isOwnProfile={isOwnProfile} />}
                {numericId && <UserEventSignups userId={numericId} />}
                {profile.characters.length > 0 && <GroupedCharacters characters={profile.characters} games={games} />}
                <HeartedGamesSection hearted={hearted} />
                <SteamLibrarySection steamLibrary={steamLibrary} />
            </div>
        </div>
    );
}

/**
 * Public user profile page (ROK-181).
 * Shows username, avatar, member since, and characters.
 */
export function UserProfilePage(): JSX.Element {
    const { userId } = useParams<{ userId: string }>();
    const numericId = userId ? parseInt(userId, 10) : undefined;
    const location = useLocation();
    const { user: currentUser } = useAuth();
    const { data: profile, isLoading, error } = useUserProfile(numericId);
    const { games } = useGameRegistry();

    if (isLoading) return <UserProfileSkeleton />;

    if (error || !profile) {
        const guestState = location.state as unknown;
        if (isGuestRouteState(guestState)) {
            return <GuestProfile username={guestState.username} discordId={guestState.discordId} avatarHash={guestState.avatarHash} />;
        }
        return <UserNotFound />;
    }

    return (
        <ProfileContent profile={profile} numericId={numericId} isOwnProfile={currentUser?.id === numericId} games={games} />
    );
}

/** Profile header with avatar and username */
function ProfileHeader({ profile, profileAvatar, memberSince }: {
    profile: { username: string };
    profileAvatar: { url: string | null };
    memberSince: string;
}): JSX.Element {
    return (
        <div className="user-profile-header">
            {profileAvatar.url ? (
                <img src={profileAvatar.url} alt={profile.username} className="user-profile-avatar"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
                <div className="user-profile-avatar user-profile-avatar--initials">
                    {profile.username.charAt(0).toUpperCase()}
                </div>
            )}
            <div className="user-profile-info">
                <h1 className="user-profile-name">{profile.username}</h1>
                <p className="user-profile-meta">Member {memberSince}</p>
            </div>
        </div>
    );
}
