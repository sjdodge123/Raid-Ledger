import type { JSX } from "react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CharacterDto,
  UserHeartedGameDto,
  ActivityPeriod,
  ItadGamePricingDto,
} from "@raid-ledger/contract";
import type { PricingMap } from "../user-profile-page";
import { GameRowPill } from "../../components/games/game-row-pill";
import { formatPlaytime } from "../../lib/activity-utils";
import { PERIOD_LABELS } from "../../lib/activity-utils";
import { useUserActivity } from "../../hooks/use-user-profile";
import { getMyPreferences, updatePreference } from "../../lib/api-client";
import { CharacterCardCompact } from "../../components/characters/character-card-compact";
import { ActivityContent } from "./activity-modal";
import { RadioGroup } from "../../components/ui/radio-group";
import { Checkbox } from "../../components/ui/checkbox";
export {
  GuestProfile,
  SteamLibrarySection,
} from "./user-profile-extra-sections";
export { SteamWishlistSection } from "./steam-wishlist-section";

/** Clickable game card for the hearted games section (ROK-282, ROK-805) */
export function HeartedGameCard({
  game,
  pricing,
}: {
  game: UserHeartedGameDto;
  pricing?: ItadGamePricingDto | null;
}): JSX.Element {
  return (
    <GameRowPill
      name={game.name}
      coverUrl={game.coverUrl}
      href={`/games/${game.id}`}
      pricing={pricing}
      subtitle={game.playtimeSeconds != null && game.playtimeSeconds > 0 ? formatPlaytime(game.playtimeSeconds) : undefined}
    />
  );
}

/** Groups characters by game and sorts (main first, then by display order) */
function groupAndSortCharacters(
  characters: CharacterDto[],
): Record<string, CharacterDto[]> {
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
  return grouped;
}

/** Single game group within the characters section */
function GameCharacterGroup({
  gameId,
  gameName,
  chars,
}: {
  gameId: string;
  gameName: string;
  chars: CharacterDto[];
}): JSX.Element {
  return (
    <div key={gameId}>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-foreground">{gameName}</h3>
        <span className="text-xs text-muted">
          {chars.length} character{chars.length !== 1 ? "s" : ""}
        </span>
        <div className="flex-1 border-t border-edge-subtle" />
      </div>
      <div className="space-y-2">
        {chars.map((character) => (
          <CharacterCardCompact key={character.id} character={character} />
        ))}
      </div>
    </div>
  );
}

/** Characters grouped by game, matching the My Characters page pattern (ROK-308) */
export function GroupedCharacters({
  characters,
  games,
}: {
  characters: CharacterDto[];
  games: { id: number; name: string }[];
}): JSX.Element {
  const gameNameMap = new Map(games.map((g) => [g.id, g.name]));
  const grouped = groupAndSortCharacters(characters);
  return (
    <div className="user-profile-section">
      <h2 className="user-profile-section-title">
        Characters ({characters.length})
      </h2>
      <div className="space-y-6">
        {Object.entries(grouped).map(([gameId, chars]) => (
          <GameCharacterGroup
            key={gameId}
            gameId={gameId}
            gameName={gameNameMap.get(Number(gameId)) ?? "Unknown Game"}
            chars={chars}
          />
        ))}
      </div>
    </div>
  );
}

/** Period selector for the activity section — a segmented RadioGroup (ROK-1648) */
function PeriodSelector({
  period,
  setPeriod,
}: {
  period: ActivityPeriod;
  setPeriod: (p: ActivityPeriod) => void;
}): JSX.Element {
  return (
    <RadioGroup
      label="Activity period"
      hideLabel
      appearance="segmented"
      options={PERIOD_LABELS}
      value={period}
      onChange={setPeriod}
    />
  );
}

/** Privacy mutation hook for activity visibility */
function useActivityPrivacy(isOwnProfile: boolean): {
  showActivity: boolean;
  togglePrivacy: (v: boolean) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { data: prefs } = useQuery({
    queryKey: ["user-preferences"],
    queryFn: getMyPreferences,
    enabled: isOwnProfile,
    staleTime: Infinity,
  });
  const privacyMutation = useMutation({
    mutationFn: (value: boolean) => updatePreference("show_activity", value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
    },
  });
  return {
    showActivity: prefs?.show_activity !== false,
    togglePrivacy: (v) => privacyMutation.mutate(v),
    isPending: privacyMutation.isPending,
  };
}

/** ROK-443: Game activity section for user profiles */
export function ActivitySection({
  userId,
  isOwnProfile,
  pricingMap,
}: {
  userId: number;
  isOwnProfile: boolean;
  pricingMap: PricingMap;
}): JSX.Element {
  const [period, setPeriod] = useState<ActivityPeriod>("week");
  const { data, isLoading } = useUserActivity(userId, period);
  const entries = data?.data ?? [];
  const privacy = useActivityPrivacy(isOwnProfile);

  return (
    <div className="user-profile-section">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="user-profile-section-title mb-0">Game Activity</h2>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>
      <ActivityContent entries={entries} isLoading={isLoading} pricingMap={pricingMap} />
      {isOwnProfile && (
        <ActivityPrivacyToggle
          showActivity={privacy.showActivity}
          onToggle={privacy.togglePrivacy}
          isPending={privacy.isPending}
        />
      )}
    </div>
  );
}

/** Privacy toggle for activity visibility */
function ActivityPrivacyToggle({
  showActivity,
  onToggle,
  isPending,
}: {
  showActivity: boolean;
  onToggle: (v: boolean) => void;
  isPending: boolean;
}): JSX.Element {
  return (
    <div className="mt-4 pt-4 border-t border-edge-subtle">
      <Checkbox
        label="Show my game activity publicly"
        description="When disabled, your activity is hidden from others"
        checked={showActivity}
        onChange={(e) => onToggle(e.target.checked)}
        disabled={isPending}
      />
    </div>
  );
}
