/**
 * Resolve the game-hub link an embed shows — ROK-1872 / ROK-1873 (ROK-1428
 * §2.8, D15).
 *
 * Precedence: the event's tagged hub (if visible; the link then carries its
 * name — ROK-1895) → the game's single visible community hub → the game's
 * single server hub → ≥ 2 hubs → the `/hubs?game=<id>` directory ("Hubs")
 * → none → null. An explicit tag always wins over the game-level rule. Only
 * kinds in {@link HUB_LINK_KINDS} count.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  HUB_LINK_LABEL,
  HUBS_LINK_LABEL,
  type HubLink,
} from '../embeds/hub-link-button.helpers';

type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
type GuildKind = schema.GuildSelect['kind'];

/**
 * The one `guilds.status` an embed may link (ROK-1870 schema enum). An
 * archived (or proposed) hub keeps `hidden_at` null but `isHiddenFrom()` 404s
 * it for non-staff, so linking it would be a dead Hub button (Codex r14 P2).
 */
const LINKABLE_STATUS: schema.GuildSelect['status'] = 'active';

/**
 * Hub kinds an embed (and the channel auto-link) may link to. L11 / ROK-1873
 * added `game_community`; {@link linkableHub} keeps it to `active` hubs.
 */
export const HUB_LINK_KINDS: readonly GuildKind[] = [
  'game_server',
  'game_community',
];

/** The kinds whose hub adapter is live (owning plugin active). */
export type ActiveHubKindsSource = () => readonly GuildKind[];

let activeHubKinds: ActiveHubKindsSource | null = null;

/**
 * Codex r17 P2: wire the live-kind source (`HubKindRegistry.active()`), so a
 * hub whose plugin is off — its URL 403s — is never linked. Null (unwired,
 * e.g. a unit test) applies no kind filter beyond {@link HUB_LINK_KINDS}.
 */
export function setActiveHubKindsSource(
  source: ActiveHubKindsSource | null,
): void {
  activeHubKinds = source;
}

/** The live kinds, or null when unwired (no filter). */
function liveKinds(): readonly GuildKind[] | null {
  return activeHubKinds ? activeHubKinds() : null;
}

/** {@link HUB_LINK_KINDS} whose adapter is live — the game hubs to link. */
export function linkableHubKinds(): GuildKind[] {
  const live = liveKinds();
  if (live === null) return [...HUB_LINK_KINDS];
  return HUB_LINK_KINDS.filter((k) => live.includes(k));
}

/** Any candidate (a tagged hub too) must be of a live kind (403 otherwise). */
function liveKindWhere(): SQL | undefined {
  const live = liveKinds();
  if (live === null) return undefined;
  return live.length > 0 ? inArray(schema.guilds.kind, [...live]) : sql`false`;
}

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
  const kinds = linkableHubKinds();
  if (kinds.length === 0) return sql`false`;
  return and(
    inArray(schema.guilds.gameId, gameIds),
    inArray(schema.guilds.kind, kinds),
  );
}

/**
 * A hub a non-staff member can open: not hidden, and `active`. Shared by the
 * embed link and the channel auto-link (hub-channel-link.queries). Safe for
 * every {@link HUB_LINK_KINDS} kind: `guilds_status_kind_check` pins each
 * non-community kind to `active`.
 */
export function linkableHub(): SQL | undefined {
  return and(
    isNull(schema.guilds.hiddenAt),
    eq(schema.guilds.status, LINKABLE_STATUS),
  );
}

function candidateWhere(
  gameId: number,
  tagged: number | null,
): SQL | undefined {
  const gameHubs = gameHubsWhere([gameId]);
  const scope =
    tagged === null ? gameHubs : or(eq(schema.guilds.id, tagged), gameHubs);
  return and(linkableHub(), liveKindWhere(), scope);
}

/** One visible candidate hub. `name` is selected only where a tag can win. */
export interface HubCandidate {
  id: number;
  kind: GuildKind;
  name?: string;
}

/** The single hub of `kind`, or undefined when there are 0 or ≥ 2. */
function onlyOf(hubs: HubCandidate[], kind: GuildKind): number | undefined {
  const ofKind = hubs.filter((h) => h.kind === kind);
  return ofKind.length === 1 ? ofKind[0]?.id : undefined;
}

/**
 * Apply the D15 precedence to the visible candidate hubs. ROK-1895: when the
 * link targets the event's explicit tag, it carries the hub's name so the
 * card body can say which hub the event belongs to.
 */
export function pickHubLink(
  hubs: HubCandidate[],
  tagged: number | null,
  gameId: number,
  base: string,
): HubLink | null {
  const hubUrl = (id: number): HubLink => ({
    url: `${base}/guilds/${id}`,
    label: HUB_LINK_LABEL,
  });
  const taggedHub = hubs.find((h) => tagged !== null && h.id === tagged);
  if (taggedHub) {
    const { name } = taggedHub;
    return { ...hubUrl(taggedHub.id), ...(name ? { hubName: name } : {}) };
  }
  const community = onlyOf(hubs, 'game_community');
  if (community !== undefined) return hubUrl(community);
  if (hubs.length === 1 && hubs[0]) return hubUrl(hubs[0].id);
  if (hubs.length >= 2)
    return { url: `${base}/hubs?game=${gameId}`, label: HUBS_LINK_LABEL };
  return null;
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
    .select({
      id: schema.guilds.id,
      kind: schema.guilds.kind,
      name: schema.guilds.name,
    })
    .from(schema.guilds)
    .where(candidateWhere(gameId, tagged));
  return pickHubLink(rows, tagged, gameId, trimBase(clientUrl));
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
  if (linkableHubKinds().length === 0) return links;
  const rows = await db
    .select({
      id: schema.guilds.id,
      gameId: schema.guilds.gameId,
      kind: schema.guilds.kind,
    })
    .from(schema.guilds)
    .where(and(linkableHub(), gameHubsWhere(unique)));
  const byGame = new Map<number, HubCandidate[]>();
  for (const r of rows)
    byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r]);
  for (const [gameId, hubs] of byGame) {
    const link = pickHubLink(hubs, null, gameId, trimBase(clientUrl));
    if (link) links.set(gameId, link);
  }
  return links;
}
