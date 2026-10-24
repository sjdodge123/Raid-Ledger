/**
 * ROK-1946 lane D — the Deaths fixture's scanned-portal layer. Resets the
 * server's portal scans (portals cascade) and writes one scan on the fixture
 * world with five portals: two "home", "swamp", an empty tag (→ "Unnamed
 * portal") and a stone "ashlands". Written directly — `source_snapshot_id`
 * is nullable, so no snapshot row is needed. Coordinates sit inside the demo
 * grid (2048 px × 12 m) and ≥450 m from every fixture pin
 * (`valheim-deaths-demo-seed.data.ts`) so their buttons never overlap.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { ARMORY_FIXTURE_GAME_VERSION } from './valheim-armory-demo-seed.helpers';
import { DEATHS_FIXTURE_WORLD_UID } from './valheim-deaths-demo-seed.data';

type Db = PostgresJsDatabase<typeof schema>;

/** The fixture's portals, as `DeathsFixture.portals` reports them. */
export interface DeathsFixturePortals {
  count: number;
  /** Raw tags in seed order (`''` is the unnamed portal). */
  tags: string[];
}

const PORTALS: ReadonlyArray<{
  prefab: string;
  tag: string;
  x: number;
  z: number;
}> = [
  { prefab: 'portal_wood', tag: 'home', x: -200, z: 300 },
  { prefab: 'portal_wood', tag: 'home', x: 800, z: -300 },
  { prefab: 'portal_wood', tag: 'swamp', x: -700, z: 500 },
  { prefab: 'portal_wood', tag: '', x: 400, z: 1000 },
  { prefab: 'portal_stone', tag: 'ashlands', x: -1100, z: -700 },
];

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The fixture world's one portals scan header; returns its id. */
async function insertScan(tx: Tx, serverId: number, now: Date) {
  const scans = schema.valheimPortalScans;
  const [scan] = await tx
    .insert(scans)
    .values({
      pelicanServerId: serverId,
      worldUid: DEATHS_FIXTURE_WORLD_UID,
      gameVersion: ARMORY_FIXTURE_GAME_VERSION,
      capturedAt: now,
      omitted: 0,
      portalCount: PORTALS.length,
      sourceSnapshotId: null,
    })
    .returning({ id: scans.id });
  if (!scan) throw new Error('deaths fixture: no portal scan row');
  return scan.id;
}

/** Replace the server's portal scans with the fixture's one scan + 5 portals. */
export async function seedDeathsPortals(
  db: Db,
  serverId: number,
  now: Date,
): Promise<DeathsFixturePortals> {
  await db.transaction(async (tx) => {
    const scans = schema.valheimPortalScans;
    await tx.delete(scans).where(eq(scans.pelicanServerId, serverId));
    const scanId = await insertScan(tx, serverId, now);
    await tx.insert(schema.valheimPortals).values(
      PORTALS.map((p) => ({
        ...p,
        scanId,
        pelicanServerId: serverId,
        y: 32,
      })),
    );
  });
  return { count: PORTALS.length, tags: PORTALS.map((p) => p.tag) };
}
