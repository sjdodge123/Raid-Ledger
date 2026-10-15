import {
  SlotConfigSchema,
  type CharacterRole,
  type GuildAttendanceRowDto,
  type GuildCompositionDto,
  type GuildScheduleNightDto,
} from '@raid-ledger/contract';
import { slotConfigFromEvent } from '../../../events/signup-roster.helpers';
import type { RawRosterRow } from './guild-roster.helpers';

/**
 * ROK-1787 — pure shaping for `GET /plugins/wow/guilds/:id/raids`
 * (spec P7–P9). No DB access; the queries live in `guild-raids.queries.ts`.
 */

/** Attendance window, in weeks (contract literal). */
export const ATTENDANCE_WINDOW_WEEKS = 8;

const ROLES: readonly CharacterRole[] = ['tank', 'healer', 'dps'];
const FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
type Frequency = (typeof FREQUENCIES)[number];

/** One upcoming occurrence of a recurring series. */
export interface ScheduleSourceRow {
  id: number;
  title: string;
  startTime: Date;
  endTime: Date;
  recurrenceGroupId: string;
  recurrenceRule: unknown;
}

/** `recurrence_rule.frequency`, or null when absent/unknown. */
export function frequencyOf(rule: unknown): Frequency | null {
  if (typeof rule !== 'object' || rule === null) return null;
  const value: unknown = Reflect.get(rule, 'frequency');
  return FREQUENCIES.find((f) => f === value) ?? null;
}

/** One row per series (its earliest occurrence), by start; `isNext` on the first. */
export function toSchedule(rows: ScheduleSourceRow[]): GuildScheduleNightDto[] {
  const byGroup = new Map<string, ScheduleSourceRow>();
  for (const row of rows) {
    const prev = byGroup.get(row.recurrenceGroupId);
    if (!prev || row.startTime < prev.startTime) {
      byGroup.set(row.recurrenceGroupId, row);
    }
  }
  const sorted = [...byGroup.values()].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );
  return sorted.map((row, i) => ({
    recurrenceGroupId: row.recurrenceGroupId,
    eventId: row.id,
    title: row.title,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    frequency: frequencyOf(row.recurrenceRule),
    isNext: i === 0,
  }));
}

/**
 * A valid slotConfig with omitted counts filled by the event roster's own
 * defaults (`slotConfigFromEvent`), so the guild page matches the roster.
 */
function rosterSlots(slotConfig: unknown) {
  const parsed = SlotConfigSchema.safeParse(slotConfig);
  if (!parsed.success) return null;
  const slots = slotConfigFromEvent(parsed.data);
  return slots ? { type: parsed.data.type, slots } : null;
}

/** Sum of the slotConfig's playing slots, else maxAttendees; null = uncapped. */
export function neededFor(
  slotConfig: unknown,
  maxAttendees: number | null,
): number | null {
  const normalized = rosterSlots(slotConfig);
  if (normalized) {
    const c = normalized.slots;
    const sum =
      (c.tank ?? 0) +
      (c.healer ?? 0) +
      (c.dps ?? 0) +
      (c.flex ?? 0) +
      (c.player ?? 0);
    if (sum > 0) return sum;
  }
  return maxAttendees;
}

export interface CompositionEvent {
  id: number;
  title: string;
  startTime: Date;
  slotConfig: unknown;
}

/** filled/needed per role for an MMO-slotted event; null otherwise. */
export function toComposition(
  event: CompositionEvent,
  filledByRole: Map<string, number>,
  benched: GuildCompositionDto['benched'],
): GuildCompositionDto | null {
  const normalized = rosterSlots(event.slotConfig);
  if (!normalized || normalized.type !== 'mmo') return null;
  const config = normalized.slots;
  return {
    event: {
      id: event.id,
      title: event.title,
      startTime: event.startTime.toISOString(),
    },
    roles: ROLES.map((role) => ({
      role,
      filled: filledByRole.get(role) ?? 0,
      needed: config[role] ?? 0,
    })),
    benched,
  };
}

/** Per linked user: their main character row in this guild, else the first. */
function memberCharacters(members: RawRosterRow[]): Map<number, RawRosterRow> {
  const byUser = new Map<number, RawRosterRow>();
  for (const row of members) {
    if (row.userId === null) continue;
    const prev = byUser.get(row.userId);
    if (!prev || (row.isMain === true && prev.isMain !== true)) {
      byUser.set(row.userId, row);
    }
  }
  return byUser;
}

function compareAttendance(
  a: GuildAttendanceRowDto,
  b: GuildAttendanceRowDto,
): number {
  if (a.attended !== b.attended) return b.attended - a.attended;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/**
 * Leaderboard rows for current linked guild members only. Every row shares
 * the same `of`, so pct order equals attended order; name breaks ties.
 * `of = 0` (nothing recorded) → no rows.
 */
export function toAttendanceRows(
  members: RawRosterRow[],
  attendedByUser: Map<number, number>,
  of: number,
): GuildAttendanceRowDto[] {
  if (of === 0) return [];
  const rows: GuildAttendanceRowDto[] = [];
  for (const [userId, row] of memberCharacters(members)) {
    rows.push({
      userId,
      characterId: row.characterId,
      name: row.name,
      attended: attendedByUser.get(userId) ?? 0,
      of,
    });
  }
  return rows.sort(compareAttendance);
}

/** Hero "Next raid": the first upcoming card that has not started yet. */
export function nextRaidOf<T extends { startTime: string }>(
  cards: readonly T[],
  now: Date,
): T | null {
  return cards.find((c) => new Date(c.startTime) > now) ?? null;
}
