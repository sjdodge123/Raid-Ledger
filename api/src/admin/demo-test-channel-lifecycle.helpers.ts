/**
 * ROK-1432 (L6b) — `POST /admin/test/channel-lifecycle/*` helpers: body
 * schemas, the seed game (name-dedup guard + name lock), events, binding
 * lifecycle columns, and the age-binding back-dater. The remaining item
 * writers live in `demo-test-channel-lifecycle.seed.ts`.
 */
import { randomInt } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../drizzle/schema';
import { withGameNameLock } from '../igdb/games-name-lock.helpers';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import { defined } from '../common/defined.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const DAY_MS = 86_400_000;
const count = z.number().int().min(0).max(20).default(0);

const BindingSeedSchema = z
  .object({
    state: z.enum(['active', 'archived', 'none']).default('none'),
    pinned: z.boolean().default(false),
    autoManaged: z.boolean().default(true),
  })
  .refine((b) => b.state !== 'archived' || b.autoManaged, {
    message: 'an archived binding must be autoManaged',
  })
  .refine((b) => !b.pinned || b.autoManaged, {
    message: 'only an autoManaged binding can be pinned',
  });

export const ChannelLifecycleSeedSchema = z.object({
  gameName: z.string().min(1).max(100).default('Lifecycle Demo Game'),
  items: z
    .object({
      events: count,
      adHocEvents: count,
      polls: count,
      eventPlans: count,
      lineupVotes: count,
    })
    .default({
      events: 0,
      adHocEvents: 0,
      polls: 0,
      eventPlans: 0,
      lineupVotes: 0,
    }),
  binding: BindingSeedSchema.default({
    state: 'none',
    pinned: false,
    autoManaged: true,
  }),
  suppression: z.enum(['deleted', 'unbound']).nullable().default(null),
  serverHubWithoutChannel: z.boolean().default(false),
});

export type ChannelLifecycleSeedInput = z.infer<
  typeof ChannelLifecycleSeedSchema
>;
export type BindingSeed = ChannelLifecycleSeedInput['binding'];

export const AgeBindingSchema = z.object({
  bindingId: z.string().uuid(),
  daysAgo: z.number().int().min(1).max(400),
});

export type AgeBindingInput = z.infer<typeof AgeBindingSchema>;

/** Where every seeded item lands. */
export interface SeedContext {
  gameId: number;
  creatorId: number;
  now: Date;
}

/** A 19-digit snowflake-shaped id no real Discord object carries. */
export function fakeSnowflake(): string {
  const tail = String(randomInt(0, 100_000)).padStart(5, '0');
  return `9${String(Date.now()).padStart(13, '0')}${tail}`;
}

/** The lifecycle columns a seeded binding is stamped with after `bind()`. */
export function bindingLifecycleSet(
  b: Pick<BindingSeed, 'state' | 'pinned' | 'autoManaged'>,
  now: Date,
): {
  lifecycleState: 'active' | 'archived';
  autoManaged: boolean;
  pinned: boolean;
  archivedAt: Date | null;
  restoreParentId: string | null;
  updatedAt: Date;
} {
  const archived = b.state === 'archived';
  return {
    lifecycleState: archived ? 'archived' : 'active',
    autoManaged: b.autoManaged,
    pinned: b.pinned,
    archivedAt: archived ? now : null,
    restoreParentId: archived ? fakeSnowflake() : null,
    updatedAt: now,
  };
}

/** Find-or-create the seed game under the games name lock (idempotent). */
export async function ensureSeedGame(
  db: Db,
  name: string,
): Promise<{ id: number; name: string }> {
  return withGameNameLock(db, name, async (tx) => {
    const found = await findGameByNormalizedName(tx, name);
    if (found) return { id: found.id, name: found.name };
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-lc`;
    const [row] = await tx
      .insert(schema.games)
      .values({ name, slug, igdbId: null })
      .returning({ id: schema.games.id, name: schema.games.name });
    return defined(row, `seed game ${name}`);
  });
}

/** `scheduled` events 3 days out, then `adHoc` ad-hoc events 2 days ago. */
export async function seedEvents(
  db: Db,
  ctx: SeedContext,
  scheduled: number,
  adHoc: number,
): Promise<number[]> {
  const rows = Array.from({ length: scheduled + adHoc }, (_, i) => {
    const isAdHoc = i >= scheduled;
    const start = new Date(ctx.now.getTime() + (isAdHoc ? -2 : 3) * DAY_MS);
    const end = new Date(start.getTime() + 3_600_000);
    const duration: [Date, Date] = [start, end];
    const title = `Lifecycle ${isAdHoc ? 'ad-hoc' : 'event'} ${i + 1}`;
    return {
      title,
      gameId: ctx.gameId,
      creatorId: ctx.creatorId,
      duration,
      isAdHoc,
    };
  });
  if (rows.length === 0) return [];
  const ids = await db
    .insert(schema.events)
    .values(rows)
    .returning({ id: schema.events.id });
  return ids.map((r) => r.id);
}

/** `col - daysAgo days` (null stays null). */
function back(col: AnyColumn, days: number): SQL {
  return sql`${col} - make_interval(days => ${days})`;
}

/** Back-date the binding's archive stamp and every activity row of its game. */
export async function ageBinding(
  db: Db,
  input: { bindingId: string; daysAgo: number },
): Promise<{ bindingId: string; gameId: number | null; shiftedDays: number }> {
  const cb = schema.channelBindings;
  const [row] = await db
    .select({ id: cb.id, gameId: cb.gameId })
    .from(cb)
    .where(eq(cb.id, input.bindingId))
    .limit(1);
  if (!row) throw new NotFoundException(`Binding ${input.bindingId} not found`);
  const d = input.daysAgo;
  await db
    .update(cb)
    .set({
      archivedAt: back(cb.archivedAt, d),
      createdAt: back(cb.createdAt, d),
    })
    .where(eq(cb.id, row.id));
  if (row.gameId !== null) await ageGameActivity(db, row.gameId, d);
  return { bindingId: row.id, gameId: row.gameId, shiftedDays: d };
}

/** Shift events, polls (+ their votes), event plans and lineup votes back. */
async function ageGameActivity(
  db: Db,
  gameId: number,
  d: number,
): Promise<void> {
  const { events: e, communityLineupMatches: m } = schema;
  const iv = sql`make_interval(days => ${d})`;
  await db
    .update(e)
    .set({
      duration: sql`tsrange(lower(${e.duration}) - ${iv}, upper(${e.duration}) - ${iv})`,
    })
    .where(eq(e.gameId, gameId));
  await db
    .update(m)
    .set({ createdAt: back(m.createdAt, d) })
    .where(eq(m.gameId, gameId));
  const slots = db
    .select({ id: schema.communityLineupScheduleSlots.id })
    .from(schema.communityLineupScheduleSlots)
    .innerJoin(m, eq(m.id, schema.communityLineupScheduleSlots.matchId))
    .where(eq(m.gameId, gameId));
  const sv = schema.communityLineupScheduleVotes;
  await db
    .update(sv)
    .set({ createdAt: back(sv.createdAt, d) })
    .where(inArray(sv.slotId, slots));
  const p = schema.eventPlans;
  await db
    .update(p)
    .set({ createdAt: back(p.createdAt, d) })
    .where(eq(p.gameId, gameId));
  const lv = schema.communityLineupVotes;
  await db
    .update(lv)
    .set({ createdAt: back(lv.createdAt, d) })
    .where(eq(lv.gameId, gameId));
}
