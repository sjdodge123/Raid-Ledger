import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { HubJoinPrompt } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { DbOrTx } from './community-membership.queries';

/**
 * ROK-1893 P1 (§8d) — reads + writes of `hub_join_prompts`, the per-(hub,
 * user) "Join <hub>?" / "You joined <hub>" prompts raised by auto-membership.
 */

const p = schema.hubJoinPrompts;
const g = schema.guilds;
const m = schema.hubCommunityMembers;

/** The hub an event is tagged to, with the fields the auto-membership rule reads. */
export interface TaggedHub {
  hubId: number;
  kind: schema.GuildSelect['kind'];
  status: schema.GuildSelect['status'];
  hiddenAt: Date | null;
  autoMembership: schema.GuildSelect['autoMembership'];
}

/** The hub `events.guild_id` points at, or null for an untagged event. */
export async function findEventHub(
  db: DbOrTx,
  eventId: number,
): Promise<TaggedHub | null> {
  const [row] = await db
    .select({
      hubId: g.id,
      kind: g.kind,
      status: g.status,
      hiddenAt: g.hiddenAt,
      autoMembership: g.autoMembership,
    })
    .from(schema.events)
    .innerJoin(g, eq(g.id, schema.events.guildId))
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row ?? null;
}

/** One prompt row. */
export type HubJoinPromptRow = schema.HubJoinPromptSelect;

/** The (hub, user) prompt, dismissed or not. */
export async function findPrompt(
  db: DbOrTx,
  hubId: number,
  userId: number,
): Promise<HubJoinPromptRow | null> {
  const [row] = await db
    .select()
    .from(p)
    .where(and(eq(p.guildId, hubId), eq(p.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** A prompt by id, only when it belongs to `userId`. */
export async function findOwnPrompt(
  db: DbOrTx,
  id: number,
  userId: number,
): Promise<HubJoinPromptRow | null> {
  const [row] = await db
    .select()
    .from(p)
    .where(and(eq(p.id, id), eq(p.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** What raised a prompt. */
export interface PromptSource {
  source: 'signup' | 'vote';
  sourceRef: number | null;
}

/** `suggest`: insert once — an existing row (dismissed or not) wins. */
export async function insertSuggestPrompt(
  db: DbOrTx,
  hubId: number,
  userId: number,
  src: PromptSource,
): Promise<void> {
  await db
    .insert(p)
    .values({ guildId: hubId, userId, kind: 'suggest', ...src })
    .onConflictDoNothing({ target: [p.guildId, p.userId] });
}

/** `auto`: the one-time "You joined" notice; replaces an open suggestion. */
export async function upsertAutoJoinedPrompt(
  db: DbOrTx,
  hubId: number,
  userId: number,
  src: PromptSource,
): Promise<void> {
  const values = { kind: 'auto-joined' as const, ...src };
  await db
    .insert(p)
    .values({ guildId: hubId, userId, ...values })
    .onConflictDoUpdate({
      target: [p.guildId, p.userId],
      set: { ...values, createdAt: new Date(), dismissedAt: null },
    });
}

/** Mark a prompt dismissed (idempotent — the first dismissal time stays). */
export async function dismissPrompt(db: DbOrTx, id: number): Promise<void> {
  await db
    .update(p)
    .set({ dismissedAt: sql`COALESCE(${p.dismissedAt}, now())` })
    .where(eq(p.id, id));
}

/** The prompt's user's LIVE membership row of the prompt's hub. */
function liveMemberOfPrompt(): SQL | undefined {
  return and(
    eq(m.guildId, p.guildId),
    eq(m.userId, p.userId),
    isNull(m.leftAt),
    isNull(m.bannedAt),
  );
}

/** Undismissed, on a visible active community hub, and not a stale suggest. */
function openPromptOf(userId: number): SQL | undefined {
  return and(
    eq(p.userId, userId),
    isNull(p.dismissedAt),
    eq(g.kind, 'game_community'),
    eq(g.status, 'active'),
    isNull(g.hiddenAt),
    sql`NOT (${p.kind} = 'suggest' AND ${m.id} IS NOT NULL)`,
  );
}

/**
 * The user's open prompts on visible, active community hubs. A `suggest`
 * whose user has since become a live member is stale and left out.
 */
export async function listOpenPrompts(
  db: DbOrTx,
  userId: number,
): Promise<HubJoinPrompt[]> {
  const rows = await db
    .select({
      id: p.id,
      kind: p.kind,
      hubId: p.guildId,
      hubName: g.name,
      source: p.source,
      sourceRef: p.sourceRef,
      createdAt: p.createdAt,
    })
    .from(p)
    .innerJoin(g, eq(g.id, p.guildId))
    .leftJoin(m, liveMemberOfPrompt())
    .where(openPromptOf(userId))
    .orderBy(desc(p.createdAt), desc(p.id));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Set a community hub's auto-membership mode. */
export async function setAutoMembership(
  db: DbOrTx,
  hubId: number,
  mode: schema.GuildSelect['autoMembership'],
): Promise<void> {
  await db
    .update(g)
    .set({ autoMembership: mode, updatedAt: new Date() })
    .where(eq(g.id, hubId));
}
