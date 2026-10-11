/**
 * Pure decisions for private standalone polls shared by link (ROK-1750).
 *
 * Token generation, token shape, who may reset a link, the reschedule-poll
 * rejection (operator ruling R3) and the create-time fan-out gate. No DB here
 * — the queries live in `standalone-poll-share-query.helpers.ts` — so every
 * rule below is unit-testable without a database.
 *
 * Never log a token: callers log `lineupId` / `matchId` only (spec §3).
 */
import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { StandalonePollVisibility } from '@raid-ledger/contract';

/** 32 random bytes → 43 base64url chars (256 bits, spec D2). */
const SHARE_TOKEN_BYTES = 32;

/** Exact shape `generateShareToken` produces; anything else is a 404. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A fresh, URL-safe, 256-bit share token. */
export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

/** True when `token` could be one `generateShareToken` minted. */
export function isWellFormedShareToken(token: string): boolean {
  return SHARE_TOKEN_PATTERN.test(token);
}

/**
 * R3: a reschedule poll (one linked to an event) is public-only — its audience
 * is the event roster. The contract's refine already 400s this on the HTTP
 * path; this guards the internal callers (post-event follow-up) too.
 *
 * @throws BadRequestException for `private` + `linkedEventId`.
 */
export function assertVisibilityAllowed(
  visibility: StandalonePollVisibility | undefined,
  linkedEventId: number | undefined,
): void {
  if (visibility === 'private' && linkedEventId !== undefined) {
    throw new BadRequestException({
      visibility: ['A reschedule poll (linkedEventId) cannot be private'],
    });
  }
}

/** Visibility + token a new poll is stored with: private polls get a token. */
export function buildShareSettings(
  visibility: StandalonePollVisibility | undefined,
): { visibility: StandalonePollVisibility; shareToken: string | null } {
  return visibility === 'private'
    ? { visibility: 'private', shareToken: generateShareToken() }
    : { visibility: 'public', shareToken: null };
}

/** Which create-time notifications a poll of this visibility may send. */
export interface CreateFanout {
  /** DM every game-interested user (`notifyInterestedUsers`). */
  interestBroadcast: boolean;
  /** Post the poll card into a Discord channel. */
  channelEmbed: boolean;
  /** DM only the members the creator picked. */
  pickedMembersDm: boolean;
}

/**
 * Spec §3 / A6: a private poll is never broadcast and never posted to a
 * channel — only the members the creator picked hear about it.
 */
export function resolveCreateFanout(
  visibility: StandalonePollVisibility,
): CreateFanout {
  const isPrivate = visibility === 'private';
  return {
    interestBroadcast: !isPrivate,
    channelEmbed: !isPrivate,
    pickedMembersDm: isPrivate,
  };
}

/** R2: only the poll creator or an admin/operator may reset the link. */
export function canResetShareToken(
  callerId: number,
  isAdmin: boolean,
  creatorId: number | null,
): boolean {
  return isAdmin || (creatorId !== null && callerId === creatorId);
}

/**
 * Spec D4: the creator and admins already have access — redeeming adds no
 * invitee / member rows for them.
 */
export function redeemAddsRows(
  callerId: number,
  isAdmin: boolean,
  creatorId: number | null,
): boolean {
  return !isAdmin && callerId !== creatorId;
}

/**
 * Share fields a poll response carries for a viewer (spec §3 "Token
 * exposure"): the token only on a private poll, only to a signed-in viewer
 * who reached the response (the view guard already limits that to creator /
 * invitee / admin). Null otherwise and on every public poll.
 */
export function shareFieldsForViewer(
  lineup: { visibility?: string | null; shareToken?: string | null },
  viewerId: number | null,
): { visibility: StandalonePollVisibility; shareToken: string | null } {
  if (lineup.visibility !== 'private') {
    return { visibility: 'public', shareToken: null };
  }
  return {
    visibility: 'private',
    shareToken: viewerId !== null ? (lineup.shareToken ?? null) : null,
  };
}
