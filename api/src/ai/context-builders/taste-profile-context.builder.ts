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
import { UsersService } from '../../users/users.service';

const MAX_TOP_AXES = 5;
const MAX_LOW_AXES = 3;
const MAX_PARTNERS = 5;
const MAX_PARTNER_AXES = 3;

@Injectable()
export class TasteProfileContextBuilder {
  constructor(
    private readonly tasteProfile: TasteProfileService,
    private readonly users: UsersService,
  ) {}

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

    const resolvedIds = resolved.map((p) => p.userId);
    const [partnerLists, users] = await Promise.all([
      Promise.all(
        resolved.map((profile) =>
          this.buildPartnerContexts(profile.coPlayPartners),
        ),
      ),
      this.users.findByIds(resolvedIds),
    ]);
    const usernameById = new Map(users.map((u) => [u.id, u.username]));

    const contexts: TasteProfileContextDto[] = resolved.map((profile, i) => ({
      userId: profile.userId,
      username: resolveUsername(profile.userId, usernameById),
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
 * Resolve a real username from the batch lookup; fall back to
 * "Unknown player" when the user was hard-deleted after their profile
 * was computed.
 */
function resolveUsername(
  userId: number,
  usernames: Map<number, string>,
): string {
  return usernames.get(userId) ?? 'Unknown player';
}
