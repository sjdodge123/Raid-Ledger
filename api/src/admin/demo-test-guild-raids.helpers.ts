/**
 * ROK-1787 — guild events for the DEMO_MODE `POST /admin/test/wow/seed-guild`
 * fixture (Raids tab + Overview widgets). Find-or-create keyed on
 * (guild_id, title), so a re-call returns the same ids:
 *   - a tagged weekly series of 3 MMO-slotted (2/4/14) nights; its first
 *     night has the GM (tank) + officer (healer) signed and roster-assigned
 *     and the member benched;
 *   - one tagged raid a week ago with attendance recorded: member attended,
 *     officer no_show.
 * Direct inserts: no Discord embeds or reminders are scheduled.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const SEED_RAID_SERIES_TITLE = 'Molten Core Night';
export const SEED_PAST_RAID_TITLE = 'Onyxia Clear';
const SLOT_CONFIG = { type: 'mmo', tank: 2, healer: 4, dps: 14 };
const HOUR = 3600 * 1000;
const WEEK = 7 * 24 * HOUR;
const SERIES_NIGHTS = 3;

export interface SeedRaider {
  userId: number;
  characterId: string;
}

/** A seeded linked user → raider; every linked role owns a character. */
export function raiderOf(user: {
  userId: number;
  characterId: string | null;
}): SeedRaider {
  if (user.characterId === null) {
    throw new Error(`seed-guild user ${String(user.userId)} has no character`);
  }
  return { userId: user.userId, characterId: user.characterId };
}

export interface SeedRaidCtx {
  guildId: number;
  gameId: number;
  now: Date;
  gm: SeedRaider;
  officer: SeedRaider;
  member: SeedRaider;
}

export interface SeededGuildRaids {
  seriesGroupId: string;
  /** Series nights, earliest first; the first is the composition event. */
  seriesEventIds: number[];
  pastEventId: number;
}

async function findSeeded(db: Db, guildId: number, title: string) {
  return db
    .select({
      id: schema.events.id,
      groupId: schema.events.recurrenceGroupId,
    })
    .from(schema.events)
    .where(
      and(eq(schema.events.guildId, guildId), eq(schema.events.title, title)),
    )
    .orderBy(asc(sql`lower(${schema.events.duration})`));
}

interface NewEvent {
  title: string;
  start: Date;
  groupId: string | null;
}

async function insertEvent(
  db: Db,
  ctx: SeedRaidCtx,
  ev: NewEvent,
): Promise<number> {
  const until = new Date(ctx.now.getTime() + (SERIES_NIGHTS + 1) * WEEK);
  const [row] = await db
    .insert(schema.events)
    .values({
      title: ev.title,
      gameId: ctx.gameId,
      creatorId: ctx.gm.userId,
      duration: [ev.start, new Date(ev.start.getTime() + 3 * HOUR)],
      slotConfig: SLOT_CONFIG,
      guildId: ctx.guildId,
      recurrenceGroupId: ev.groupId,
      recurrenceRule: ev.groupId
        ? { frequency: 'weekly', until: until.toISOString() }
        : null,
    })
    .returning({ id: schema.events.id });
  return defined(row, `seed-guild event ${ev.title}`).id;
}

async function signUp(
  db: Db,
  eventId: number,
  raider: SeedRaider,
  attendanceStatus: string | null = null,
): Promise<number> {
  const [row] = await db
    .insert(schema.eventSignups)
    .values({
      eventId,
      userId: raider.userId,
      characterId: raider.characterId,
      confirmationStatus: 'confirmed',
      attendanceStatus,
      attendanceRecordedAt: attendanceStatus ? new Date() : null,
    })
    .returning({ id: schema.eventSignups.id });
  return defined(row, `seed-guild signup ${String(raider.userId)}`).id;
}

async function assign(
  db: Db,
  eventId: number,
  raider: SeedRaider,
  role: string,
): Promise<void> {
  const signupId = await signUp(db, eventId, raider);
  await db
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId, role, position: 1 });
}

async function ensureSeries(
  db: Db,
  ctx: SeedRaidCtx,
): Promise<Omit<SeededGuildRaids, 'pastEventId'>> {
  const found = await findSeeded(db, ctx.guildId, SEED_RAID_SERIES_TITLE);
  const [first] = found;
  if (first) {
    if (first.groupId === null) throw new Error('seeded series has no group');
    return {
      seriesGroupId: first.groupId,
      seriesEventIds: found.map((r) => r.id),
    };
  }
  const seriesGroupId = randomUUID();
  const base = Math.ceil(ctx.now.getTime() / HOUR) * HOUR;
  const ids: number[] = [];
  for (let week = 1; week <= SERIES_NIGHTS; week++) {
    const start = new Date(base + week * WEEK);
    const ev = { title: SEED_RAID_SERIES_TITLE, start, groupId: seriesGroupId };
    ids.push(await insertEvent(db, ctx, ev));
  }
  const night = defined(ids[0], 'first series night');
  await assign(db, night, ctx.gm, 'tank');
  await assign(db, night, ctx.officer, 'healer');
  await assign(db, night, ctx.member, 'bench');
  return { seriesGroupId, seriesEventIds: ids };
}

async function ensurePastRaid(db: Db, ctx: SeedRaidCtx): Promise<number> {
  const [found] = await findSeeded(db, ctx.guildId, SEED_PAST_RAID_TITLE);
  if (found) return found.id;
  const start = new Date(ctx.now.getTime() - WEEK);
  const ev = { title: SEED_PAST_RAID_TITLE, start, groupId: null };
  const id = await insertEvent(db, ctx, ev);
  await signUp(db, id, ctx.member, 'attended');
  await signUp(db, id, ctx.officer, 'no_show');
  return id;
}

/** Idempotent per guild: the series + the past raid (see file header). */
export async function ensureGuildRaids(
  db: Db,
  ctx: SeedRaidCtx,
): Promise<SeededGuildRaids> {
  const series = await ensureSeries(db, ctx);
  const pastEventId = await ensurePastRaid(db, ctx);
  return { ...series, pastEventId };
}
