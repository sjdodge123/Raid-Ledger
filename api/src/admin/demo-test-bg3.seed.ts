/**
 * ROK-1958 — the database writes behind `POST /admin/test/bg3/seed-hub`.
 * Idempotent per tag: a re-seed reuses the tag's hub row and replaces its
 * BG3 state (campaigns cascade claims + key bindings, hub settings, the
 * memberships and the seeded users' saves). Save rows go through the ingest
 * handler's own mapper (`toBg3SaveRow`), so they match a real companion
 * upload column for column. Community hubs are not in the reset-to-seed
 * wipe list (`demo-test-reset.helpers.ts`), and neither are these rows.
 */
import { NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { toBg3SaveRow } from '../plugins/bg3/ingest/bg3-save.handler';
import { insertCommunityHub } from '../guilds/community/community-proposals.queries';
import { upsertJoin } from '../guilds/community/community-membership.queries';
import {
  bg3SeedDiscordId,
  planSeedSaves,
  seedSaveMessage,
} from './demo-test-bg3.helpers';
import { findBg3GameId } from './demo-test-community-hubs.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * The BG3 game's id (ROK-2038: by IGDB id, then any `BG3_GAME_SLUGS` slug);
 * 404 only when the env has no BG3 row at all.
 */
export async function findBg3Game(db: Db): Promise<number> {
  const id = await findBg3GameId(db);
  if (id === null)
    throw new NotFoundException("Baldur's Gate 3 game not found");
  return id;
}

async function findUserId(db: Db, username: string): Promise<number | null> {
  const u = schema.users;
  const [hit] = await db
    .select({ id: u.id })
    .from(u)
    .where(eq(u.username, username))
    .limit(1);
  return hit?.id ?? null;
}

/** Find-or-create an A2-eligible member user (seen in the Discord guild). */
export async function ensureBg3User(db: Db, username: string): Promise<number> {
  const u = schema.users;
  const now = new Date();
  const hit = await findUserId(db, username);
  if (hit !== null) {
    await db
      .update(u)
      .set({ guildMemberSeenAt: now, deactivatedAt: null })
      .where(eq(u.id, hit));
    return hit;
  }
  await db
    .insert(u)
    .values({
      username,
      discordId: bg3SeedDiscordId(username),
      role: 'member',
      guildMemberSeenAt: now,
    })
    .onConflictDoNothing({ target: u.discordId });
  const created = await findUserId(db, username);
  if (created === null) throw new Error(`bg3 seed: user ${username} missing`);
  return created;
}

/** The tag's hub (reused across re-seeds), created active when absent. */
export async function ensureBg3Hub(
  db: Db,
  gameId: number,
  name: string,
  hostId: number,
): Promise<number> {
  const g = schema.guilds;
  const [hit] = await db
    .select({ id: g.id })
    .from(g)
    .where(
      and(eq(g.gameId, gameId), eq(g.name, name), eq(g.kind, 'game_community')),
    )
    .limit(1);
  if (hit) return hit.id;
  const hub = await insertCommunityHub(db, {
    gameId,
    name,
    blurb: `${name} — a seeded BG3 community hub.`,
    status: 'active',
    proposedBy: hostId,
    reviewedBy: null,
  });
  return hub.id;
}

/** Drop the hub's BG3 state, its memberships and the users' BG3 rows. */
export async function resetBg3Fixture(
  db: Db,
  hubId: number,
  userIds: number[],
): Promise<void> {
  await db
    .delete(schema.bg3Saves)
    .where(inArray(schema.bg3Saves.uploaderUserId, userIds));
  await db
    .delete(schema.bg3UserDefaults)
    .where(inArray(schema.bg3UserDefaults.userId, userIds));
  await db
    .delete(schema.bg3CampaignKeys)
    .where(inArray(schema.bg3CampaignKeys.userId, userIds));
  await db
    .delete(schema.bg3HubSettings)
    .where(eq(schema.bg3HubSettings.guildId, hubId));
  await db
    .delete(schema.bg3Campaigns)
    .where(eq(schema.bg3Campaigns.guildId, hubId));
  await db
    .delete(schema.hubCommunityMembers)
    .where(eq(schema.hubCommunityMembers.guildId, hubId));
}

/** Leader (host), officer, two members; the visitor stays out. */
export async function seedBg3Memberships(
  db: Db,
  hubId: number,
  ids: { host: number; officer: number; member: number; claimer: number },
): Promise<void> {
  await upsertJoin(db, hubId, ids.host, 'leader');
  await upsertJoin(db, hubId, ids.officer, 'officer');
  await upsertJoin(db, hubId, ids.member, 'member');
  await upsertJoin(db, hubId, ids.claimer, 'member');
}

/** The host's campaign, made active; spoilers per the variant. */
export async function seedBg3Campaign(
  db: Db,
  hubId: number,
  hostId: number,
  name: string,
  spoilers: boolean,
): Promise<number> {
  const [row] = await db
    .insert(schema.bg3Campaigns)
    .values({
      guildId: hubId,
      name,
      hostUserId: hostId,
      createdByUserId: hostId,
    })
    .returning({ id: schema.bg3Campaigns.id });
  if (!row) throw new Error('bg3 seed: campaign insert returned no row');
  await db.insert(schema.bg3HubSettings).values({
    guildId: hubId,
    activeCampaignId: row.id,
    hideLocationAndScreenshots: spoilers,
    updatedByUserId: hostId,
  });
  return row.id;
}

/** Bind the host's save folder to the campaign (D-6), like "Add my saves". */
export async function bindBg3Key(
  db: Db,
  userId: number,
  campaignKey: string,
  campaignId: number,
): Promise<void> {
  await db
    .insert(schema.bg3CampaignKeys)
    .values({ userId, campaignKey, campaignId });
}

/** The host's save history; `campaignId` null leaves them unassigned. */
export async function seedBg3Saves(
  db: Db,
  hostId: number,
  campaignKey: string,
  campaignId: number | null,
  now: Date,
): Promise<{ saves: number; sessions: number }> {
  const plans = planSeedSaves(now);
  const ctx = { userId: hostId, deviceId: null, receivedAt: now };
  const rows = plans.map((p, i) =>
    toBg3SaveRow(ctx, seedSaveMessage(p, i, campaignKey), campaignId),
  );
  await db.insert(schema.bg3Saves).values(rows).onConflictDoNothing();
  const sessions = new Set(plans.map((p) => p.sessionIndex)).size;
  return { saves: rows.length, sessions };
}

export async function seedBg3Claim(
  db: Db,
  campaignId: number,
  slotKey: string,
  userId: number,
): Promise<void> {
  await db
    .insert(schema.bg3PartyClaims)
    .values({ campaignId, slotKey, userId });
}
