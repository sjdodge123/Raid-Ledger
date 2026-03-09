import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SteamLibraryEntryDto } from "@raid-ledger/contract";
import type { UseInfiniteListResult } from "../../hooks/use-infinite-list";
import { formatPlaytime } from "../../lib/activity-utils";
import { SteamIcon } from "../../components/icons/SteamIcon";
import { InfiniteScrollSentinel } from "../../components/ui/infinite-scroll-sentinel";
import { buildDiscordAvatarUrl } from "../../lib/avatar";
import { useBranding } from "../../hooks/use-branding";

/** Cover image or placeholder for game cards */
function GameCover({
  url,
  alt,
}: {
  url: string | null;
  alt: string;
}): JSX.Element {
  if (url) {
    return (
      <img
        src={url}
        alt={alt}
        className="w-10 h-14 rounded object-cover flex-shrink-0"
        loading="lazy"
      />
    );
  }
  return (
    <div className="w-10 h-14 rounded bg-overlay flex items-center justify-center text-muted flex-shrink-0 text-xs">
      ?
    </div>
  );
}

/** Single Steam library entry card (ROK-754) */
function SteamLibraryCard({
  entry,
}: {
  entry: SteamLibraryEntryDto;
}): JSX.Element {
  return (
    <Link
      to={`/games/${entry.gameId}`}
      className="bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
    >
      <GameCover url={entry.coverUrl} alt={entry.gameName} />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-foreground truncate block">
          {entry.gameName}
        </span>
        <span className="text-sm text-muted">
          {formatPlaytime(entry.playtimeSeconds)}
        </span>
      </div>
    </Link>
  );
}

/** ROK-754: Steam Library section with infinite scroll */
export function SteamLibrarySection({
  steamLibrary,
}: {
  steamLibrary: UseInfiniteListResult<SteamLibraryEntryDto>;
}): JSX.Element | null {
  if (steamLibrary.items.length === 0 && !steamLibrary.isLoading) return null;
  return (
    <div className="user-profile-section">
      <div className="flex items-center gap-2 mb-3">
        <SteamIcon className="w-5 h-5 text-muted" />
        <h2 className="user-profile-section-title mb-0">
          Steam Library
          {steamLibrary.total > 0 ? ` (${steamLibrary.total})` : ""}
        </h2>
      </div>
      <div className="flex flex-col gap-2">
        {steamLibrary.items.map((entry) => (
          <SteamLibraryCard key={entry.gameId} entry={entry} />
        ))}
      </div>
      {steamLibrary.items.length > 0 && (
        <InfiniteScrollSentinel
          sentinelRef={steamLibrary.sentinelRef}
          isFetchingNextPage={steamLibrary.isFetchingNextPage}
          hasNextPage={steamLibrary.hasNextPage}
        />
      )}
    </div>
  );
}

/** Guest profile header with avatar and info */
function GuestProfileHeader({
  username,
  avatarUrl,
  communityName,
}: {
  username: string;
  avatarUrl: string | null;
  communityName: string;
}): JSX.Element {
  return (
    <div className="user-profile-header">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={username}
          className="user-profile-avatar"
          onError={(e) => {
            e.currentTarget.style.display = "none";
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
  );
}

/** Guest profile page for non-member Discord users (ROK-381). */
export function GuestProfile({
  username,
  discordId,
  avatarHash,
}: {
  username: string;
  discordId: string;
  avatarHash: string | null;
}): JSX.Element {
  const navigate = useNavigate();
  const { brandingQuery } = useBranding();
  const communityName = brandingQuery.data?.communityName ?? "this community";
  const avatarUrl = buildDiscordAvatarUrl(discordId, avatarHash);
  return (
    <div className="user-profile-page">
      <div className="user-profile-card">
        <GuestProfileHeader
          username={username}
          avatarUrl={avatarUrl}
          communityName={communityName}
        />
        <div className="user-profile-guest-actions">
          <button onClick={() => navigate(-1)} className="btn btn-primary">
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
