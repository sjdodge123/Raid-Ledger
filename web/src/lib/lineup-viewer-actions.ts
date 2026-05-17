/**
 * Maps `LineupDetailResponseDto.viewerSubmissions` (the submitted-at
 * timestamps surfaced for the authed viewer) onto the partial `UserActions`
 * shape that `getHeroState` accepts. Closes the AC3 chain:
 *
 *   DB column `nominations_submitted_at`
 *     → API `viewerSubmissions.nominationsSubmittedAt: string | null`
 *     → selector input `userActions.hasSubmittedNominations: boolean`
 *     → `getHeroState` tone flip `'action'` → `'waiting'`.
 *
 * Composite stories (ROK-1297 S1, ROK-1298 Sv, ROK-1300 Ss+Sx) will spread
 * this output into the `UserActions` they hand to `JourneyHero` when they
 * swap `HeroNextStep` → `JourneyHero`.
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';

export interface ViewerSubmittedActions {
  hasSubmittedNominations: boolean;
  hasSubmittedVotes: boolean;
}

export function mapViewerSubmissionsToUserActions(
  lineup: Pick<LineupDetailResponseDto, 'viewerSubmissions'>,
): ViewerSubmittedActions {
  const submissions = lineup.viewerSubmissions;
  return {
    hasSubmittedNominations: submissions?.nominationsSubmittedAt != null,
    hasSubmittedVotes: submissions?.votesSubmittedAt != null,
  };
}
