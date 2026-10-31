/**
 * ROK-1960 F4 — the cross-hub guard's reads for `PUT me/campaign-keys/:key`.
 * A bind moves every one of the caller's saves with the key, and those saves
 * can sit in several hubs (`setDefault` only files unassigned rows), so the
 * guard looks at ALL of them plus the binding — under the per-user
 * `lockBg3UserCampaigns` lock (F5) so no other writer can re-file a row
 * between the check and the bind's UPDATE.
 */
import { and, count, eq, isNull, ne, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
export type Bg3Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Bg3KeyHubLocation {
  campaignId: number;
  campaignName: string;
  hubId: number;
  hubName: string;
}

/** What a bind would move out of other hubs; `null` from `crossHubPlan` = nothing. */
export interface Bg3CrossHubPlan {
  saveCount: number;
  locations: Bg3KeyHubLocation[];
}

const c = schema.bg3Campaigns;
const s = schema.bg3Saves;
const k = schema.bg3CampaignKeys;
const g = schema.guilds;
const LOCATION_COLS = {
  campaignId: c.id,
  campaignName: c.name,
  hubId: g.id,
  hubName: g.name,
};

export function ownRows(userId: number, key: string) {
  return and(eq(s.uploaderUserId, userId), eq(s.campaignKey, key));
}

/** Every campaign holding one of the caller's saves with `key`, plus the bound one. */
async function keyLocations(
  tx: Bg3Tx,
  userId: number,
  key: string,
): Promise<Bg3KeyHubLocation[]> {
  const bound = await tx
    .select(LOCATION_COLS)
    .from(k)
    .innerJoin(c, eq(c.id, k.campaignId))
    .innerJoin(g, eq(g.id, c.guildId))
    .where(and(eq(k.userId, userId), eq(k.campaignKey, key)));
  const filed = await tx
    .selectDistinct(LOCATION_COLS)
    .from(s)
    .innerJoin(c, eq(c.id, s.campaignId))
    .innerJoin(g, eq(g.id, c.guildId))
    .where(ownRows(userId, key));
  const byCampaign = new Map<number, Bg3KeyHubLocation>();
  for (const at of [...bound, ...filed]) byCampaign.set(at.campaignId, at);
  return [...byCampaign.values()];
}

/** The caller's saves with `key` that are not already in `campaignId`. */
async function movingCount(
  tx: Bg3Tx,
  userId: number,
  key: string,
  campaignId: number,
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(s)
    .where(
      and(
        ownRows(userId, key),
        or(isNull(s.campaignId), ne(s.campaignId, campaignId)),
      ),
    );
  return row?.n ?? 0;
}

/** The places in hubs other than `hubId` a bind to `campaignId` would move; `null` = none. */
export async function crossHubPlan(
  tx: Bg3Tx,
  userId: number,
  key: string,
  target: { campaignId: number; hubId: number },
): Promise<Bg3CrossHubPlan | null> {
  const all = await keyLocations(tx, userId, key);
  const locations = all.filter((at) => at.hubId !== target.hubId);
  if (locations.length === 0) return null;
  const saveCount = await movingCount(tx, userId, key, target.campaignId);
  return { saveCount, locations };
}
