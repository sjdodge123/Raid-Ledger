import { and, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { PelicanExecutor } from '../pelican-plugin-lock.helpers';
import type { PelicanTx } from '../pelican-servers.repository';
import { windowStart } from './server-hub-membership.helpers';
import { refreshMemberCount } from './server-hub-membership.queries';

/** The server fields the toggle needs (row already locked by the caller). */
export interface HubServerRef {
  id: number;
  name: string;
  gameId: number;
}

/**
 * ROK-1831 L-5 admin toggle. On: create the `game_server` hub (or clear its
 * `hidden_at`), then backfill members (L-4). Off: set `hidden_at`; every
 * member row is kept. The caller refuses "on" while the server is unmapped.
 */
export async function applyCommunityHub(
  tx: PelicanTx,
  server: HubServerRef,
  enabled: boolean,
  now: Date,
): Promise<void> {
  const g = schema.guilds;
  const [existing] = await tx
    .select({ id: g.id })
    .from(g)
    .where(eq(g.pelicanServerId, server.id))
    .limit(1);
  if (!enabled) {
    if (existing) await setHidden(tx, existing.id, now);
    return;
  }
  const guildId = existing
    ? (await setHidden(tx, existing.id, null), existing.id)
    : await insertHub(tx, server);
  await backfillFromQuickPlay(tx, guildId, server.id, now);
  await refreshMemberCount(tx, guildId, now);
}

/**
 * ROK-1831 ruling "the hub name follows the server": copy the server's name
 * and game onto its hub. A cleared mapping hides the hub instead (no game to
 * authorise event tagging against); `communityHub: true` re-enables it once a
 * game is mapped again. No-op when the server has no hub.
 */
export async function syncServerHub(
  tx: PelicanTx,
  server: { id: number; name: string; gameId: number | null },
  now: Date,
): Promise<void> {
  const g = schema.guilds;
  if (server.gameId === null) {
    await tx
      .update(g)
      .set({ hiddenAt: now })
      .where(and(eq(g.pelicanServerId, server.id), isNull(g.hiddenAt)));
    return;
  }
  const name = server.name.slice(0, 64);
  await tx
    .update(g)
    .set({ name, nameKey: name.toLowerCase(), gameId: server.gameId })
    .where(eq(g.pelicanServerId, server.id));
}

/** Server deleted / missing from the panel → hide its hub, keep the data. */
export async function hideServerHubs(
  tx: PelicanExecutor,
  serverIds: number[] | 'all',
  now: Date,
): Promise<void> {
  const g = schema.guilds;
  const which =
    serverIds === 'all'
      ? isNotNull(g.pelicanServerId)
      : inArray(g.pelicanServerId, serverIds);
  if (serverIds !== 'all' && serverIds.length === 0) return;
  await tx
    .update(g)
    .set({ hiddenAt: now })
    .where(and(which, isNull(g.hiddenAt)));
}

async function setHidden(tx: PelicanTx, id: number, at: Date | null) {
  await tx
    .update(schema.guilds)
    .set({ hiddenAt: at })
    .where(eq(schema.guilds.id, id));
}

async function insertHub(tx: PelicanTx, server: HubServerRef): Promise<number> {
  const name = server.name.slice(0, 64);
  const [row] = await tx
    .insert(schema.guilds)
    .values({
      gameId: server.gameId,
      kind: 'game_server',
      name,
      nameKey: name.toLowerCase(),
      region: 'server',
      source: 'pelican',
      pelicanServerId: server.id,
    })
    .returning({ id: schema.guilds.id });
  if (!row) throw new Error('server hub insert returned no row');
  return row.id;
}

/** L-4: linked Quick Play participants of this server within the window. */
async function backfillFromQuickPlay(
  tx: PelicanTx,
  guildId: number,
  serverId: number,
  now: Date,
): Promise<void> {
  const rows = await loadBackfillRows(tx, serverId, now);
  const values = rows.flatMap((r) =>
    r.userId === null
      ? []
      : [
          {
            guildId,
            userId: r.userId,
            source: 'presence' as const,
            firstSeenAt: r.first,
            lastSeenAt: r.last,
            characterName: r.characterName?.slice(0, 64) ?? null,
          },
        ],
  );
  if (values.length === 0) return;
  await tx.insert(schema.hubServerMembers).values(values).onConflictDoNothing();
}

function loadBackfillRows(tx: PelicanTx, serverId: number, now: Date) {
  const p = schema.adHocParticipants;
  return tx
    .select({
      userId: p.userId,
      first: sql<Date>`min(${p.joinedAt})`.mapWith(p.joinedAt),
      last: sql<Date>`max(coalesce(${p.leftAt}, ${p.joinedAt}))`.mapWith(
        p.joinedAt,
      ),
      characterName: sql<string | null>`max(${p.characterName})`,
    })
    .from(p)
    .where(
      and(
        eq(p.pelicanServerId, serverId),
        isNotNull(p.userId),
        gte(p.joinedAt, windowStart(now)),
      ),
    )
    .groupBy(p.userId);
}
