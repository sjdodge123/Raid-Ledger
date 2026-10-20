/**
 * ROK-1432 (L6b) — the channel-lifecycle seed's item writers: standalone
 * polls (a scheduling match + slot + vote), event plans, lineup votes, the
 * game's binding, its suppression row and a server hub with no channel.
 */
import { randomInt } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import type { ChannelBindingsService } from '../discord-bot/services/channel-bindings.service';
import {
  bindingLifecycleSet,
  fakeSnowflake,
  type BindingSeed,
  type SeedContext,
} from './demo-test-channel-lifecycle.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const DAY_MS = 86_400_000;
const PURPOSE = 'game-announcements';

/** A fresh lineup (public_slug is varchar(16) + unique). */
async function insertLineup(db: Db, ctx: SeedContext): Promise<number> {
  const [row] = await db
    .insert(schema.communityLineups)
    .values({
      title: 'Lifecycle demo lineup',
      createdBy: ctx.creatorId,
      publicSlug: `lc${randomInt(0, 1e9)}`.slice(0, 16),
    })
    .returning({ id: schema.communityLineups.id });
  return defined(row, 'lifecycle lineup').id;
}

/** One standalone poll: a scheduling match with one slot and one fresh vote. */
async function seedPoll(db: Db, ctx: SeedContext): Promise<number> {
  const lineupId = await insertLineup(db, ctx);
  const [match] = await db
    .insert(schema.communityLineupMatches)
    .values({ lineupId, gameId: ctx.gameId, status: 'scheduling' })
    .returning({ id: schema.communityLineupMatches.id });
  const matchId = defined(match, 'lifecycle poll').id;
  const proposedTime = new Date(ctx.now.getTime() + 3 * DAY_MS);
  const [slot] = await db
    .insert(schema.communityLineupScheduleSlots)
    .values({ matchId, proposedTime, suggestedBy: 'user' })
    .returning({ id: schema.communityLineupScheduleSlots.id });
  await db.insert(schema.communityLineupScheduleVotes).values({
    slotId: defined(slot, 'lifecycle slot').id,
    userId: ctx.creatorId,
  });
  return matchId;
}

/** `n` polls; returns the first poll (match) id or null. */
export async function seedPolls(
  db: Db,
  ctx: SeedContext,
  n: number,
): Promise<number | null> {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 1) ids.push(await seedPoll(db, ctx));
  return ids[0] ?? null;
}

/** `n` event plans; returns the first plan id or null. */
export async function seedEventPlans(
  db: Db,
  ctx: SeedContext,
  n: number,
): Promise<string | null> {
  const date = new Date(ctx.now.getTime() + 2 * DAY_MS).toISOString();
  const rows = Array.from({ length: n }, (_, i) => ({
    creatorId: ctx.creatorId,
    title: `Lifecycle plan ${i + 1}`,
    gameId: ctx.gameId,
    durationMinutes: 60,
    pollOptions: [{ date, label: 'A' }],
    pollDurationHours: 24,
  }));
  if (rows.length === 0) return null;
  const ids = await db
    .insert(schema.eventPlans)
    .values(rows)
    .returning({ id: schema.eventPlans.id });
  return ids[0]?.id ?? null;
}

/** One vote on the game in each of `n` fresh lineups; returns the first lineup. */
export async function seedLineupVotes(
  db: Db,
  ctx: SeedContext,
  n: number,
): Promise<number | null> {
  const lineupIds: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const lineupId = await insertLineup(db, ctx);
    await db
      .insert(schema.communityLineupVotes)
      .values({ lineupId, gameId: ctx.gameId, userId: ctx.creatorId });
    lineupIds.push(lineupId);
  }
  return lineupIds[0] ?? null;
}

function gameBindingWhere(guildId: string, gameId: number) {
  const cb = schema.channelBindings;
  return and(
    eq(cb.guildId, guildId),
    eq(cb.gameId, gameId),
    eq(cb.bindingPurpose, PURPOSE),
    isNull(cb.recurrenceGroupId),
  );
}

/** The channel id of the binding matching `where`, if any. */
async function existingChannelId(
  db: Db,
  where: ReturnType<typeof gameBindingWhere>,
): Promise<string | null> {
  const cb = schema.channelBindings;
  const [row] = await db
    .select({ channelId: cb.channelId })
    .from(cb)
    .where(where)
    .limit(1);
  return row?.channelId ?? null;
}

/**
 * The game's non-series announcements binding: 'none' deletes it; otherwise
 * `bind()` (reusing the existing channel id, else a fake snowflake) then the
 * lifecycle columns are stamped.
 */
export async function seedBinding(
  db: Db,
  bindings: Pick<ChannelBindingsService, 'bind'>,
  ref: { guildId: string; gameId: number; now: Date },
  seed: BindingSeed,
): Promise<{ bindingId: string; channelId: string } | null> {
  const cb = schema.channelBindings;
  const where = gameBindingWhere(ref.guildId, ref.gameId);
  if (seed.state === 'none') {
    await db.delete(cb).where(where);
    return null;
  }
  const channelId = (await existingChannelId(db, where)) ?? fakeSnowflake();
  const { binding } = await bindings.bind(
    ref.guildId,
    channelId,
    'text',
    PURPOSE,
    ref.gameId,
  );
  await db
    .update(cb)
    .set(bindingLifecycleSet(seed, ref.now))
    .where(eq(cb.id, binding.id));
  return { bindingId: binding.id, channelId };
}

/** Upsert (or, for null, clear) the game's lifecycle suppression row. */
export async function seedSuppression(
  db: Db,
  ref: { guildId: string; gameId: number; now: Date },
  reason: 'deleted' | 'unbound' | null,
): Promise<void> {
  const s = schema.channelLifecycleSuppressions;
  if (reason === null) {
    await db
      .delete(s)
      .where(and(eq(s.guildId, ref.guildId), eq(s.gameId, ref.gameId)));
    return;
  }
  await db
    .insert(s)
    .values({ guildId: ref.guildId, gameId: ref.gameId, reason })
    .onConflictDoUpdate({
      target: [s.guildId, s.gameId],
      set: { reason, createdAt: ref.now },
    });
}

/** The game's game_server hub, inserted when absent. */
async function findOrInsertServerHub(
  db: Db,
  game: { id: number; name: string },
): Promise<number> {
  const g = schema.guilds;
  const [found] = await db
    .select({ id: g.id })
    .from(g)
    .where(and(eq(g.gameId, game.id), eq(g.kind, 'game_server')))
    .limit(1);
  if (found) return found.id;
  const name = `${game.name} Server`.slice(0, 64);
  const values = {
    gameId: game.id,
    kind: 'game_server' as const,
    region: 'us',
    name,
    nameKey: name.toLowerCase(),
    source: 'pelican',
  };
  const [row] = await db.insert(g).values(values).returning({ id: g.id });
  return defined(row, 'lifecycle hub').id;
}

/** A visible game_server hub on the game whose profile has no channel. */
export async function seedServerHubWithoutChannel(
  db: Db,
  game: { id: number; name: string },
): Promise<number> {
  const hubId = await findOrInsertServerHub(db, game);
  const g = schema.guilds;
  await db.update(g).set({ hiddenAt: null }).where(eq(g.id, hubId));
  const p = schema.guildProfiles;
  const blank = { discordChannelId: null, discordChannelSource: null };
  await db
    .insert(p)
    .values({ guildId: hubId, ...blank })
    .onConflictDoUpdate({ target: p.guildId, set: blank });
  return hubId;
}
