import type { JSX } from "react";
import { useState, useMemo } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import {
  useUserProfile,
  useUserHeartedGames,
  useUserSteamLibrary,
  useUserSteamWishlist,
  useUserActivity,
} from "../hooks/use-user-profile";
import { useTasteProfile } from "../hooks/use-taste-profile";
import { useGamesPricingBatch } from "../hooks/use-games-pricing-batch";
import { useGameRegistry } from "../hooks/use-game-registry";
import { useAuth } from "../hooks/use-auth";
import { formatDistanceToNow } from "date-fns";
import { resolveAvatar, toAvatarUser } from "../lib/avatar";
import { UserEventSignups } from "../components/profile/UserEventSignups";
import type {
  UserProfileDto,
  ItadGamePricingDto,
  TasteProfileArchetype,
} from "@raid-ledger/contract";
import {
  HeartedGameCard,
  GroupedCharacters,
  ActivitySection,
  GuestProfile,
  SteamLibrarySection,
  SteamWishlistSection,
} from "./user-profile/user-profile-components";
import { HeartedGamesModal } from "./user-profile/hearted-games-modal";
import { isGuestRouteState } from "./user-profile/user-profile-helpers";
import { TasteProfileSection } from "./user-profile/taste-profile/TasteProfileSection";
import { ArchetypePill } from "./user-profile/taste-profile/ArchetypePill";
import { isEmptyTasteProfile } from "./user-profile/taste-profile/taste-profile-helpers";
import "./user-profile-page.css";

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
        <p>
          The user you&apos;re looking for doesn&apos;t exist or has been
          removed.
        </p>
        <Link to="/calendar" className="btn btn-primary">
          Back to Calendar
        </Link>
      </div>
    </div>
  );
}

export type PricingMap = Map<number, ItadGamePricingDto | null>;

/** Hearted games list section with show-10 + modal (ROK-745) */
function HeartedGamesSection({
  userId,
  pricingMap,
}: {
  userId: number;
  pricingMap: PricingMap;
}): JSX.Element | null {
  const { data, isLoading } = useUserHeartedGames(userId);
  const [showModal, setShowModal] = useState(false);
  const items = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  if (items.length === 0 && !isLoading) return null;
  return (
    <div className="user-profile-section">
      <h2 className="user-profile-section-title">Interested In{total > 0 ? ` (${total})` : ""}</h2>
      <div className="flex flex-col gap-2">
        {items.map((game) => <HeartedGameCard key={game.id} game={game} pricing={pricingMap.get(game.id)} />)}
      </div>
      {total > 10 && (
        <button onClick={() => setShowModal(true)} className="mt-3 text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
          Show All ({total})
        </button>
      )}
      <HeartedGamesModal userId={userId} isOpen={showModal} onClose={() => setShowModal(false)} total={total} pricingMap={pricingMap} />
    </div>
  );
}

/** Collect game IDs from all profile sections for one batch pricing call. */
function useProfilePricing(userId: number | undefined): PricingMap {
  const { data: hearted } = useUserHeartedGames(userId);
  const { data: steamLib } = useUserSteamLibrary(userId);
  const { data: steamWish } = useUserSteamWishlist(userId);
  const { data: activity } = useUserActivity(userId, "week");
  const allIds = useMemo(() => {
    const ids: number[] = [];
    if (hearted?.data) for (const g of hearted.data) ids.push(g.id);
    if (steamLib?.data) for (const e of steamLib.data) ids.push(e.gameId);
    if (steamWish?.data) for (const e of steamWish.data) ids.push(e.gameId);
    if (activity?.data) for (const e of activity.data) ids.push(e.gameId);
    return ids;
  }, [hearted, steamLib, steamWish, activity]);
  return useGamesPricingBatch(allIds);
}

/** Profile sections body (split out so `ProfileContent` stays <30 lines). */
function ProfileSections({
  profile,
  numericId,
  isOwnProfile,
  games,
  pricingMap,
  tasteProfile,
}: {
  profile: UserProfileDto;
  numericId: number | undefined;
  isOwnProfile: boolean;
  games: { id: number; name: string }[];
  pricingMap: PricingMap;
  tasteProfile: ReturnType<typeof useTasteProfile>;
}): JSX.Element {
  return (
    <>
      {numericId !== undefined && (
        <TasteProfileSection userId={numericId} queryResult={tasteProfile} />
      )}
      {numericId && <ActivitySection userId={numericId} isOwnProfile={isOwnProfile} pricingMap={pricingMap} />}
      {numericId && <UserEventSignups userId={numericId} />}
      {profile.characters.length > 0 && <GroupedCharacters characters={profile.characters} games={games} />}
      {numericId && <HeartedGamesSection userId={numericId} pricingMap={pricingMap} />}
      {numericId && <SteamLibrarySection userId={numericId} pricingMap={pricingMap} />}
      {numericId && <SteamWishlistSection userId={numericId} pricingMap={pricingMap} />}
    </>
  );
}

/**
 * Resolve the archetype pill for the profile header.
 * Returns null when the user has no data yet (empty profile).
 */
function useHeaderArchetype(
  tasteProfile: ReturnType<typeof useTasteProfile>,
): TasteProfileArchetype | null {
  if (!tasteProfile.data) return null;
  if (isEmptyTasteProfile(tasteProfile.data)) return null;
  return tasteProfile.data.archetype;
}

interface ProfileContentProps {
  profile: UserProfileDto;
  numericId: number | undefined;
  isOwnProfile: boolean;
  games: { id: number; name: string }[];
}

/** Loaded profile content */
function ProfileContent({ profile, numericId, isOwnProfile, games }: ProfileContentProps): JSX.Element {
  const memberSince = formatDistanceToNow(new Date(profile.createdAt), { addSuffix: true });
  const profileAvatar = resolveAvatar(toAvatarUser(profile));
  const pricingMap = useProfilePricing(numericId);
  const tasteProfile = useTasteProfile(numericId);
  const headerArchetype = useHeaderArchetype(tasteProfile);
  return (
    <div className="user-profile-page">
      <div className="user-profile-card">
        <ProfileHeader profile={profile} profileAvatar={profileAvatar} memberSince={memberSince} archetype={headerArchetype} />
        <ProfileSections
          profile={profile}
          numericId={numericId}
          isOwnProfile={isOwnProfile}
          games={games}
          pricingMap={pricingMap}
          tasteProfile={tasteProfile}
        />
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
      return (
        <GuestProfile
          username={guestState.username}
          discordId={guestState.discordId}
          avatarHash={guestState.avatarHash}
        />
      );
    }
    return <UserNotFound />;
  }

  return (
    <ProfileContent
      profile={profile}
      numericId={numericId}
      isOwnProfile={currentUser?.id === numericId}
      games={games}
    />
  );
}

/** Profile header with avatar and username */
function ProfileHeader({
  profile,
  profileAvatar,
  memberSince,
  archetype,
}: {
  profile: { username: string };
  profileAvatar: { url: string | null };
  memberSince: string;
  archetype: TasteProfileArchetype | null;
}): JSX.Element {
  return (
    <div className="user-profile-header">
      {profileAvatar.url ? (
        <img src={profileAvatar.url} alt={profile.username} className="user-profile-avatar"
          onError={(e) => { e.currentTarget.style.display = "none"; }} />
      ) : (
        <div className="user-profile-avatar user-profile-avatar--initials">{profile.username.charAt(0).toUpperCase()}</div>
      )}
      <div className="user-profile-info">
        <h1 className="user-profile-name">
          {profile.username}
          {archetype && <ArchetypePill archetype={archetype} />}
        </h1>
        <p className="user-profile-meta">Member {memberSince}</p>
      </div>
    </div>
  );
}
