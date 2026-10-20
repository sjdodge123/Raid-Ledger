/**
 * Resolve the game-hub link an embed shows — ROK-1872 (ROK-1428 §2.8, D15).
 *
 * Precedence: the event's tagged hub (if visible) → the game's single visible
 * hub → ≥ 2 hubs → the OLDEST one (lowest id; deterministic, and the first
 * hub a game got) → none → null. Only kinds in {@link HUB_LINK_KINDS} count.
 * TODO(ROK-1873): link the `/hubs?game=<id>` directory for ≥ 2 hubs once
 * ROK-1870's route ships (L11) — until then that URL would be a 404 (D15).
 */
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  HUB_LINK_LABEL,
  type HubLink,
} from '../embeds/hub-link-button.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type GuildKind = schema.GuildSelect['kind'];

/**
 * Hub kinds an embed may link to. ROK-1870 / L11 appends `game_community`
 * (with its `status = 'active'` predicate) once that kind exists.
 */
export const HUB_LINK_KINDS: readonly GuildKind[] = ['game_server'];

/** Input for {@link resolveGameHubLink}. */
export interface HubLinkInput {
  gameId: number | null | undefined;
  /** `events.guild_id` — the hub the event is tagged to. */
  taggedGuildId?: number | null | undefined;
  clientUrl: string | null | undefined;
}

/** Minimal logger surface for the best-effort wrapper. */
export interface HubLinkLogger {
  warn(message: string): void;
}

function trimBase(clientUrl: string): string {
  return clientUrl.replace(/\/+$/, '');
}

function gameHubsWhere(gameIds: number[]): SQL | undefined {
  return and(
    inArray(schema.guilds.gameId, gameIds),
    inArray(schema.guilds.kind, [...HUB_LINK_KINDS]),
  );
}

function candidateWhere(
  gameId: number,
  tagged: number | null,
): SQL | undefined {
  const gameHubs = gameHubsWhere([gameId]);
  const scope =
    tagged === null ? gameHubs : or(eq(schema.guilds.id, tagged), gameHubs);
  return and(isNull(schema.guilds.hiddenAt), scope);
}

/** Apply the D15 precedence to the visible candidate hub ids. */
function pickHubLink(
  ids: number[],
  tagged: number | null,
  gameId: number,
  base: string,
): HubLink | null {
  const oldest = ids.length > 0 ? Math.min(...ids) : undefined;
  const target = tagged !== null && ids.includes(tagged) ? tagged : oldest;
  if (target === undefined) return null;
  // TODO(ROK-1873): ids.length >= 2 → `${base}/hubs?game=${gameId}` (HUBS_LINK_LABEL).
  void gameId;
  return { url: `${base}/guilds/${target}`, label: HUB_LINK_LABEL };
}

/**
 * Resolve one event / poll / lineup's hub link.
 *
 * @returns The absolute link, or null (no hub, no game, no `CLIENT_URL`).
 */
export async function resolveGameHubLink(
  db: Db,
  input: HubLinkInput,
): Promise<HubLink | null> {
  const { gameId, clientUrl } = input;
  if (!clientUrl || gameId === null || gameId === undefined) return null;
  const tagged = input.taggedGuildId ?? null;
  const rows = await db
    .select({ id: schema.guilds.id })
    .from(schema.guilds)
    .where(candidateWhere(gameId, tagged));
  const ids = rows.map((r) => r.id);
  return pickHubLink(ids, tagged, gameId, trimBase(clientUrl));
}

/**
 * {@link resolveGameHubLink}, best-effort: a failure logs and yields null so
 * the embed renders without the link (§2.9 — never fail an embed post).
 */
export async function resolveGameHubLinkSafe(
  db: Db,
  input: HubLinkInput,
  logger: HubLinkLogger,
): Promise<HubLink | null> {
  try {
    return await resolveGameHubLink(db, input);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Hub link resolution failed for game ${input.gameId}: ${reason}`,
    );
    return null;
  }
}

/**
 * Batch variant (no tagged hub): one query for many games.
 *
 * @returns Game id → link; games without a hub are absent.
 */
export async function resolveGameHubLinks(
  db: Db,
  gameIds: number[],
  clientUrl: string | null | undefined,
): Promise<Map<number, HubLink>> {
  const links = new Map<number, HubLink>();
  const unique = [...new Set(gameIds)];
  if (!clientUrl || unique.length === 0) return links;
  const rows = await db
    .select({ id: schema.guilds.id, gameId: schema.guilds.gameId })
    .from(schema.guilds)
    .where(and(isNull(schema.guilds.hiddenAt), gameHubsWhere(unique)));
  const byGame = new Map<number, number[]>();
  for (const r of rows)
    byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r.id]);
  for (const [gameId, ids] of byGame) {
    const link = pickHubLink(ids, null, gameId, trimBase(clientUrl));
    if (link) links.set(gameId, link);
  }
  return links;
}
