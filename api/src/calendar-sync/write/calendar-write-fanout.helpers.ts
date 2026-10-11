/**
 * ROK-1596 A4 (epic ROK-669 §4.5.1): who a signup / event emit fans out to.
 * Pure DB reads — the listener turns each key into one `reconcile` job, and
 * the reconcile function decides create / update / delete / noop. The
 * fan-out is therefore deliberately wide (every signup status): a key that
 * needs nothing costs one noop job.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { ReconcileKey } from './calendar-write-reconcile.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const conn = schema.calendarConnections;

/** A connection that writes: write on and not paused / disconnecting. */
const writeConnection = and(
  eq(conn.writeEnabled, true),
  eq(conn.status, 'active'),
);

/** The user's write connections (at most one today — L4 — but a list). */
export async function findUserWriteConnectionIds(
  db: Db,
  userId: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: conn.id })
    .from(conn)
    .where(and(eq(conn.userId, userId), writeConnection));
  return rows.map((r) => r.id);
}

/** Every existing copy (link row) of the event, any state. */
export async function findEventLinkKeys(
  db: Db,
  eventId: number,
): Promise<ReconcileKey[]> {
  const links = schema.calendarEventLinks;
  return db
    .select({
      connectionId: links.connectionId,
      eventId: links.eventId,
      userId: links.userId,
    })
    .from(links)
    .where(eq(links.eventId, eventId));
}

/** (a) the event's signed-in signups × their write connections. */
async function findEventSignupKeys(
  db: Db,
  eventId: number,
): Promise<ReconcileKey[]> {
  const signups = schema.eventSignups;
  const rows = await db
    .select({ connectionId: conn.id, userId: signups.userId })
    .from(signups)
    .innerJoin(conn, eq(conn.userId, signups.userId))
    .where(
      and(
        eq(signups.eventId, eventId),
        isNotNull(signups.userId),
        writeConnection,
      ),
    );
  return rows.flatMap((r) =>
    r.userId === null
      ? []
      : [{ connectionId: r.connectionId, eventId, userId: r.userId }],
  );
}

/** Drop duplicate (connection, event, user) keys, keeping the first. */
export function dedupeKeys(keys: ReconcileKey[]): ReconcileKey[] {
  const seen = new Set<string>();
  return keys.filter((k) => {
    const id = `${k.connectionId}:${k.eventId}:${k.userId}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * §4.5.1 event-wide fan-out: (a) current signups with a write connection ∪
 * (b) existing links — (b) covers a copy whose signup is already gone.
 */
export async function findEventFanoutKeys(
  db: Db,
  eventId: number,
): Promise<ReconcileKey[]> {
  const [signupKeys, linkKeys] = await Promise.all([
    findEventSignupKeys(db, eventId),
    findEventLinkKeys(db, eventId),
  ]);
  return dedupeKeys([...signupKeys, ...linkKeys]);
}
