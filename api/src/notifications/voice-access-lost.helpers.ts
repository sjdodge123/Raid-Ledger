import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UpdateRosterDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { CreateNotificationInput } from './notification.types';
import { shouldCreateEphemeralChannel } from '../discord-bot/services/ephemeral-voice.gate.helpers';

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

/** Users a roster edit moved from a real slot or the pool onto the bench. */
export function findNewlyBenchedUserIds(
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupLike>,
  oldRoleBySignupId: Map<number, string | null>,
): number[] {
  const ids: number[] = [];
  for (const a of assignments) {
    if (!a.userId || a.slot !== 'bench') continue;
    const signup = signupByUserId.get(a.userId);
    if (!signup) continue;
    // No old assignment = the unassigned pool, which is on the allow-list.
    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    if (hadVoiceAccess(signup.status, oldRole)) ids.push(a.userId);
  }
  return ids;
}

/** The two ephemeral-voice switches; `SettingsService` satisfies it. */
export interface VoiceGateSettings {
  getEphemeralVoiceEnabled(): Promise<boolean>;
  getEphemeralVoiceForced(): Promise<boolean>;
}

export interface VoiceGateDeps {
  db: PostgresJsDatabase<typeof schema>;
  settings: VoiceGateSettings;
}

/**
 * The event qualifies when its voice is private, an ephemeral channel is on
 * per the canonical gate (global switch, force, per-event opt-in), it is not
 * cancelled, and it does not end within 10 minutes (re-joining would not
 * help). Returns the event title, or null to skip.
 */
async function loadVoiceAccessEvent(
  deps: VoiceGateDeps,
  eventId: number,
): Promise<{ title: string } | null> {
  const [ev] = await deps.db
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
  if (!ev || ev.privateVoice !== true || ev.cancelledAt || ev.endingSoon)
    return null;
  const [globalEnabled, forced] = await Promise.all([
    deps.settings.getEphemeralVoiceEnabled(),
    deps.settings.getEphemeralVoiceForced(),
  ]);
  const on = shouldCreateEphemeralChannel(
    globalEnabled,
    forced,
    ev.ephemeralVoiceEnabled,
  );
  return on ? { title: ev.title } : null;
}

/** The given users that exist and are not deactivated — one query. */
async function activeUserIds(
  db: PostgresJsDatabase<typeof schema>,
  userIds: readonly number[],
): Promise<Set<number>> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        inArray(schema.users.id, [...userIds]),
        isNull(schema.users.deactivatedAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** Event gate + active-user gate for one member (listener path). */
export async function loadVoiceAccessTarget(
  deps: VoiceGateDeps,
  eventId: number,
  userId: number,
): Promise<{ title: string } | null> {
  const ev = await loadVoiceAccessEvent(deps, eventId);
  if (!ev) return null;
  return (await activeUserIds(deps.db, [userId])).has(userId) ? ev : null;
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
 * The users (already known to have lost their allow-list place) who pass the
 * event + active-user gates: one event read, one users read. Fails open to
 * "none": a gate error must never block the removal DM itself.
 */
export async function voiceLossUserIds(
  deps: VoiceGateDeps,
  eventId: number,
  userIds: readonly number[],
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  try {
    if (!(await loadVoiceAccessEvent(deps, eventId))) return new Set();
    return await activeUserIds(deps.db, userIds);
  } catch {
    return new Set();
  }
}

/** Gate + append for a single DM (fails open to the unchanged input). */
export async function withVoiceAccessLine(
  deps: VoiceGateDeps,
  eventId: number,
  input: CreateNotificationInput,
): Promise<CreateNotificationInput> {
  const lost = await voiceLossUserIds(deps, eventId, [input.userId]);
  return lost.has(input.userId) ? appendVoiceAccessLine(input) : input;
}

/**
 * One-DM rule: members a roster edit moved onto the bench (from a slot or the
 * pool) who lost private voice — the line rides on their roster DM.
 */
export function benchedVoiceLossUserIds(
  deps: VoiceGateDeps,
  eventId: number,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupLike>,
  oldRoleBySignupId: Map<number, string | null>,
): Promise<Set<number>> {
  const benched = findNewlyBenchedUserIds(
    assignments,
    signupByUserId,
    oldRoleBySignupId,
  );
  return voiceLossUserIds(deps, eventId, benched);
}
