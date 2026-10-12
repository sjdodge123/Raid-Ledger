import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UpdateRosterDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { CreateNotificationInput } from './notification.types';

/**
 * ROK-1769: "how to get back in" DM. When a member loses their place on an
 * event whose ephemeral voice channel is private (roster-only, ROK-1386), they
 * get ONE DM saying they lost voice access and that signing up again restores
 * it. Trigger sites emit `VOICE_ACCESS_LOST_EVENT`; `VoiceAccessLostListener`
 * gates, dedupes and sends through the normal notification path.
 */
export const VOICE_ACCESS_LOST_EVENT = 'voice-access.lost';

/** `payload.subtype` marking the DM; the DM button keys its label off it. */
export const VOICE_ACCESS_LOST_SUBTYPE = 'voice_access_lost';

/** One DM per removal: repeat triggers inside this window are dropped. */
export const VOICE_ACCESS_DEDUP_TTL_SECONDS = 15 * 60;

/** Only departure emits now; the other removal paths merge into their DM. */
export type VoiceAccessLostReason = 'departed';

export interface VoiceAccessLostPayload {
  eventId: number;
  userId: number;
  reason: VoiceAccessLostReason;
}

/** Minimal emitter shape so trigger sites and specs need no Nest types. */
export interface VoiceAccessEmitter {
  emit(event: string, payload: VoiceAccessLostPayload): unknown;
}

export function voiceAccessDedupKey(eventId: number, userId: number): string {
  return `voice-access-lost:event:${eventId}:user:${userId}`;
}

/**
 * Mirrors `computeAllowedDiscordIds` (ephemeral-voice.private.helpers): only
 * signed_up/tentative rows off the bench are on a private channel's allow-list.
 */
export function hadVoiceAccess(
  status: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (status !== 'signed_up' && status !== 'tentative') return false;
  return role !== 'bench';
}

/** Emit the lost-access signal when the member was on the allow-list. */
export function emitIfVoiceAccessLost(
  emitter: VoiceAccessEmitter,
  p: VoiceAccessLostPayload & { status: string | null; role: string | null },
): void {
  if (!hadVoiceAccess(p.status, p.role)) return;
  emitter.emit(VOICE_ACCESS_LOST_EVENT, {
    eventId: p.eventId,
    userId: p.userId,
    reason: p.reason,
  });
}

type SignupLike = { id: number; status: string };

/** Users a roster edit moved from a real slot (or no slot) onto the bench. */
export function findNewlyBenchedUserIds(
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupLike>,
  oldRoleBySignupId: Map<number, string | null>,
): number[] {
  const ids: number[] = [];
  for (const a of assignments) {
    if (!a.userId || a.slot !== 'bench') continue;
    const signup = signupByUserId.get(a.userId);
    if (!signup || !oldRoleBySignupId.has(signup.id)) continue;
    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    if (hadVoiceAccess(signup.status, oldRole)) ids.push(a.userId);
  }
  return ids;
}

/**
 * The event qualifies when its voice is private, ephemeral voice is not
 * explicitly off, it is not cancelled, and it does not end within 10 minutes
 * (re-joining would not help). The user must be active (not deactivated).
 * Returns the event title, or null to skip.
 */
export async function loadVoiceAccessTarget(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
): Promise<{ title: string } | null> {
  const [ev] = await db
    .select({
      title: schema.events.title,
      privateVoice: schema.events.privateVoice,
      ephemeralVoiceEnabled: schema.events.ephemeralVoiceEnabled,
      cancelledAt: schema.events.cancelledAt,
      endingSoon: sql<boolean>`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) <= (now() AT TIME ZONE 'UTC') + interval '10 minutes'`,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!ev || ev.privateVoice !== true || ev.ephemeralVoiceEnabled === false)
    return null;
  if (ev.cancelledAt || ev.endingSoon) return null;
  const [user] = await db
    .select({ deactivatedAt: schema.users.deactivatedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user || user.deactivatedAt) return null;
  return { title: ev.title };
}

export function buildVoiceAccessLostInput(
  userId: number,
  eventId: number,
  eventTitle: string,
): CreateNotificationInput {
  return {
    userId,
    type: 'slot_vacated',
    title: 'Voice Channel Access Removed',
    message: `You no longer have access to the private voice channel for "${eventTitle}". Sign up for the event again to get your access back.`,
    payload: { eventId, subtype: VOICE_ACCESS_LOST_SUBTYPE },
  };
}

/**
 * One-DM rule (ROK-1769): removal paths that ALREADY DM the member (organizer
 * removal, roster edit to bench, tentative displaced to bench) fold this line
 * into that DM instead of emitting `VOICE_ACCESS_LOST_EVENT`. Only departure,
 * which DMs nobody else, sends the standalone voice DM.
 */
export const VOICE_ACCESS_LOST_LINE =
  'You no longer have access to the private voice channel. Sign up for the event again to get it back.';

/** Append the voice line; the subtype relabels the DM button "Sign Up". */
export function appendVoiceAccessLine(
  input: CreateNotificationInput,
): CreateNotificationInput {
  return {
    ...input,
    message: `${input.message}\n\n${VOICE_ACCESS_LOST_LINE}`,
    payload: { ...input.payload, subtype: VOICE_ACCESS_LOST_SUBTYPE },
  };
}

/**
 * The users (already known to have lost their allow-list place) whose event +
 * account pass the `loadVoiceAccessTarget` gate. Fails open to "none": a gate
 * error must never block the removal DM itself.
 */
export async function voiceLossUserIds(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userIds: readonly number[],
): Promise<Set<number>> {
  const lost = new Set<number>();
  try {
    for (const userId of userIds)
      if (await loadVoiceAccessTarget(db, eventId, userId)) lost.add(userId);
  } catch {
    return new Set();
  }
  return lost;
}

/** Gate + append for a single DM (fails open to the unchanged input). */
export async function withVoiceAccessLine(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  input: CreateNotificationInput,
): Promise<CreateNotificationInput> {
  const lost = await voiceLossUserIds(db, eventId, [input.userId]);
  return lost.has(input.userId) ? appendVoiceAccessLine(input) : input;
}
