/**
 * TasteProfileContextBuilder (ROK-950).
 *
 * Provider-agnostic context assembler that turns raw taste-profile rows
 * into the shape AI prompt builders consume. The builder does NOT touch
 * any LLM provider, keeping the feature usable even when no AI provider
 * is configured (AC 5).
 */
import { Injectable } from '@nestjs/common';
import {
  TASTE_PROFILE_AXIS_POOL,
  type TasteProfileContextBundleDto,
  type TasteProfileContextDto,
  type TasteProfilePoolAxis,
  type TopAxisDto,
  type CoPlayPartnerContextDto,
} from '@raid-ledger/contract';
import type {
  CoPlayPartnerRow,
  TasteProfileResult,
} from '../../taste-profile/queries/taste-profile-queries';
import { TasteProfileService } from '../../taste-profile/taste-profile.service';

const MAX_TOP_AXES = 5;
const MAX_LOW_AXES = 3;
const MAX_PARTNERS = 5;
const MAX_PARTNER_AXES = 3;

@Injectable()
export class TasteProfileContextBuilder {
  constructor(private readonly tasteProfile: TasteProfileService) {}

  /**
   * Build taste context bundles for the given user IDs. Users without a
   * resolvable profile go into `missingUserIds` so callers can decide how
   * to surface partial results.
   */
  async build(userIds: number[]): Promise<TasteProfileContextBundleDto> {
    if (userIds.length === 0) {
      return { contexts: [], missingUserIds: [] };
    }

    const profiles = await Promise.all(
      userIds.map((userId) => this.tasteProfile.getTasteProfile(userId)),
    );

    const missingUserIds = userIds.filter((_, i) => !profiles[i]);
    const resolved = profiles.filter(
      (p): p is TasteProfileResult => p !== null,
    );

    const partnerLists = await Promise.all(
      resolved.map((profile) =>
        this.buildPartnerContexts(profile.coPlayPartners),
      ),
    );

    const contexts: TasteProfileContextDto[] = resolved.map((profile, i) => ({
      userId: profile.userId,
      username: lookupUsernameFromPartners(profile),
      archetype: profile.archetype,
      intensityMetrics: profile.intensityMetrics,
      topAxes: pickTopAxes(profile.dimensions, MAX_TOP_AXES),
      lowAxes: pickLowAxes(profile.dimensions, MAX_LOW_AXES),
      coPlayPartners: partnerLists[i],
    }));

    return { contexts, missingUserIds };
  }

  /** Resolve each partner's own top axes by re-querying TasteProfileService. */
  private async buildPartnerContexts(
    partners: CoPlayPartnerRow[],
  ): Promise<CoPlayPartnerContextDto[]> {
    const limited = partners.slice(0, MAX_PARTNERS);
    const partnerProfiles = await Promise.all(
      limited.map((partner) =>
        this.tasteProfile.getTasteProfile(partner.userId),
      ),
    );
    return limited.map((partner, i) => {
      const partnerProfile = partnerProfiles[i];
      return {
        userId: partner.userId,
        username: partner.username,
        sessionCount: partner.sessionCount,
        topAxes: partnerProfile
          ? pickTopAxes(partnerProfile.dimensions, MAX_PARTNER_AXES)
          : [],
      };
    });
  }
}

/**
 * Pick the top N axes by score, descending. Ties are broken by the pool
 * order (stable) — good enough because the pool is deterministic.
 */
function pickTopAxes(
  dimensions: Record<TasteProfilePoolAxis, number>,
  limit: number,
): TopAxisDto[] {
  const entries = toAxisEntries(dimensions);
  entries.sort((a, b) => b.score - a.score);
  return entries.slice(0, limit);
}

/** Pick the bottom N axes by score, ascending. */
function pickLowAxes(
  dimensions: Record<TasteProfilePoolAxis, number>,
  limit: number,
): TopAxisDto[] {
  const entries = toAxisEntries(dimensions);
  entries.sort((a, b) => a.score - b.score);
  return entries.slice(0, limit);
}

/** Convert the dimensions record to an axis/score list in pool order. */
function toAxisEntries(
  dimensions: Record<TasteProfilePoolAxis, number>,
): TopAxisDto[] {
  return TASTE_PROFILE_AXIS_POOL.map((axis) => ({
    axis,
    score: dimensions[axis] ?? 0,
  }));
}

/**
 * Username is not present on the raw TasteProfileResult today — callers
 * provide it via a parallel lookup. Until a username field is added we
 * fall back to a synthetic identifier; the LLM context just needs a
 * stable handle.
 */
function lookupUsernameFromPartners(profile: TasteProfileResult): string {
  return `user:${profile.userId}`;
}
