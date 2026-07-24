/**
 * ROK-1419 (B2-2 / B2-3 / B2-4): audited dedupe + restore-path + boot-guard.
 *
 * Split out of channel-bindings.integration.spec.ts (which was already near the
 * 750-line test cap once B2-1's uniqueness matrix landed). Every describe below
 * reads the REAL migration `0161_*.sql` off disk and executes its hand-inserted
 * dedupe DML against pg16 — reading the actual shipped file is what makes these
 * regression tests rather than a re-implementation of the SQL.
 *
 * RED today: migration 0161 does not exist yet, so `loadStatements()` throws in
 * the shared beforeAll and every test in this file fails-by-construction with a
 * clear "0161 migration file not found" message. Once B2 authors the migration,
 * these become the live pins for:
 *   B2-2 — the orphan guard (a LIVE ad-hoc event is repointed to the survivor
 *          and is NEVER left NULL) + per-loser audit rows + idempotent re-run.
 *   B2-3 — the audit's loser_row + moved_events are sufficient to fully restore
 *          both the binding AND the event linkage (resolves the M-4 [UNVERIFIED]
 *          risk that the rollback record is silently empty).
 *   B2-4 — validateMigrationState flags a CRITICAL index that is absent even
 *          though its migration hash is applied (the restore-reverts-silently
 *          hole, M-1).
 */
import { eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { validateMigrationState } from '../../scripts/run-migrations-with-sentry';

const MIGRATIONS_DIR = path.join(__dirname, '../drizzle/migrations');
const GUILD = 'rok1419-dedup-guild';
const CHANNEL = 'rok1419-dedup-channel';

interface Migration0161 {
  /** The hand-inserted dedupe DML statements, in file order (no CREATE INDEX). */
  dedup: string[];
  /** The two generated CREATE UNIQUE INDEX statements. */
  createIndexes: string[];
  /** Names of the partial unique indexes, parsed from the file. */
  indexNames: string[];
  raw: string;
}

/**
 * Locate + parse the real 0161 migration. Throws (RED-by-construction) until
 * the migration exists. Splits on `--> statement-breakpoint`, drops comment-only
 * lines, and separates the dedupe DML from the generated index DDL.
 */
function loadStatements(): Migration0161 {
  const match = fs
    .readdirSync(MIGRATIONS_DIR)
    .find((f) => /^0161_.*\.sql$/.test(f));
  if (!match) {
    throw new Error(
      '0161 migration file not found in api/src/drizzle/migrations — ' +
        'ROK-1419 audited-dedupe migration not yet authored',
    );
  }
  const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, match), 'utf8');
  const chunks = raw
    .split('--> statement-breakpoint')
    .map((c) =>
      c
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((c) => c.length > 0);
  const isCreateIndex = (c: string) => /CREATE\s+UNIQUE\s+INDEX/i.test(c);
  const indexNames = [
    ...raw.matchAll(
      /CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"([^"]+)"/gi,
    ),
  ].map((m) => m[1]);
  return {
    dedup: chunks.filter((c) => !isCreateIndex(c)),
    createIndexes: chunks.filter(isCreateIndex),
    indexNames,
    raw,
  };
}

/**
 * Pull the operator restore runbook out of the migration header comment block
 * (everything above the first executable statement). Coupled to the header
 * format the spec mandates: a commented `INSERT INTO channel_bindings … ;` and
 * `UPDATE events … ;`. Extracting from the header ONLY avoids matching the
 * executable repoint `UPDATE events` inside the `WITH moved` CTE.
 */
function extractRestoreSql(raw: string): {
  restoreBindings: string;
  restoreLinkage: string;
} {
  const headerLines: string[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.length === 0 || t.startsWith('--')) {
      headerLines.push(line);
      continue;
    }
    break; // first executable line ends the header
  }
  const header = headerLines.map((l) => l.replace(/^\s*--\s?/, '')).join('\n');
  const bindings = header.match(/INSERT INTO channel_bindings\b[\s\S]*?;/i);
  const linkage = header.match(/UPDATE events\b[\s\S]*?;/i);
  if (!bindings || !linkage) {
    throw new Error(
      'Could not extract restore SQL from the 0161 header — expected commented ' +
        '`INSERT INTO channel_bindings … ;` and `UPDATE events … ;` runbook lines',
    );
  }
  return { restoreBindings: bindings[0], restoreLinkage: linkage[0] };
}

let testApp: TestApp;
let stmts: Migration0161;

beforeAll(async () => {
  testApp = await getTestApp();
  stmts = loadStatements(); // throws today -> fails-by-construction
});

afterEach(async () => {
  if (!testApp) return;
  testApp.seed = await truncateAllTables(testApp.db);
});

/** DROP the partial unique indexes so exact-twin dup rows can be seeded. */
async function dropIndexes(): Promise<void> {
  for (const name of stmts.indexNames) {
    await testApp.db.execute(sql.raw(`DROP INDEX IF EXISTS "${name}"`));
  }
}

/** Execute the dedupe DML block as one atomic transaction (mirrors migrate()). */
async function runDedupe(): Promise<void> {
  await testApp.db.transaction(async (tx) => {
    for (const s of stmts.dedup) {
      await tx.execute(sql.raw(s));
    }
  });
}

const monitorRow = (
  updatedAt: Date,
  createdAt: Date,
  config: unknown = {},
) => ({
  guildId: GUILD,
  channelId: CHANNEL,
  channelType: 'voice',
  bindingPurpose: 'game-voice-monitor',
  gameId: null as number | null,
  config: config as Record<string, unknown>,
  updatedAt,
  createdAt,
});

describe('ROK-1419 (B2-2) audited dedupe — orphan guard + per-loser audit', () => {
  it('keeps the newest survivor, repoints the LIVE ad-hoc event, SET NULLs the historical one', async () => {
    await dropIndexes();
    const game = testApp.seed.game;
    const admin = testApp.seed.adminUser;

    const [survivor] = await testApp.db
      .insert(schema.channelBindings)
      .values(
        monitorRow(
          new Date('2026-07-01T00:00:00Z'),
          new Date('2026-01-01T00:00:00Z'),
          {
            minPlayers: 9,
          },
        ),
      )
      .returning();
    const [loser1] = await testApp.db
      .insert(schema.channelBindings)
      .values(
        monitorRow(
          new Date('2026-06-01T00:00:00Z'),
          new Date('2026-02-01T00:00:00Z'),
          {
            minPlayers: 3,
          },
        ),
      )
      .returning();
    const [loser2] = await testApp.db
      .insert(schema.channelBindings)
      .values(
        monitorRow(
          new Date('2026-05-01T00:00:00Z'),
          new Date('2026-03-01T00:00:00Z'),
          {
            autoClose: true,
          },
        ),
      )
      .returning();
    // Set gameId AFTER insert so all three share the exact same non-null game
    // (a single dup group). Done in one UPDATE to avoid three separate seeds.
    await testApp.db
      .update(schema.channelBindings)
      .set({ gameId: game.id })
      .where(eq(schema.channelBindings.channelId, CHANNEL));

    const now = Date.now();
    const [liveEvent] = await testApp.db
      .insert(schema.events)
      .values({
        title: 'live ad-hoc',
        creatorId: admin.id,
        isAdHoc: true,
        channelBindingId: loser1.id,
        duration: [new Date(now - 30 * 60_000), new Date(now + 30 * 60_000)],
      })
      .returning();
    const [historicalEvent] = await testApp.db
      .insert(schema.events)
      .values({
        title: 'historical ad-hoc',
        creatorId: admin.id,
        isAdHoc: true,
        channelBindingId: loser1.id,
        duration: [
          new Date(now - 3 * 3_600_000),
          new Date(now - 2 * 3_600_000),
        ],
      })
      .returning();

    await runDedupe();

    // Exactly one binding remains — the newest-updated survivor.
    const remaining = await testApp.db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.channelId, CHANNEL));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(survivor.id);

    // THE orphan guard (the single most important assertion in this story):
    // the live event is repointed to the survivor and is NEVER left NULL.
    const [liveAfter] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, liveEvent.id));
    expect(liveAfter.channelBindingId).toBe(survivor.id);
    expect(liveAfter.channelBindingId).not.toBeNull();

    // The historical event took the FK ON DELETE SET NULL.
    const [histAfter] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, historicalEvent.id));
    expect(histAfter.channelBindingId).toBeNull();

    // Per-loser audit rows: two losers, both loser_row payloads captured,
    // survivor recorded, live repoint + historical null counted on loser1.
    const audit = await testApp.db.execute<{
      loser_binding_id: string;
      survivor_id: string;
      events_repointed: number;
      events_nulled: number;
      moved_events: Array<{ event_id: number }>;
      loser_row: { config: Record<string, unknown> };
    }>(sql`
      SELECT loser_binding_id, survivor_id, events_repointed, events_nulled,
             moved_events, loser_row
      FROM channel_bindings_dedup_audit
    `);
    const auditRows = [...audit];
    expect(auditRows).toHaveLength(2);
    for (const r of auditRows) expect(r.survivor_id).toBe(survivor.id);

    const l1 = auditRows.find((r) => r.loser_binding_id === loser1.id);
    const l2 = auditRows.find((r) => r.loser_binding_id === loser2.id);
    expect(l1).toBeDefined();
    expect(l2).toBeDefined();
    expect(Number(l1!.events_repointed)).toBe(1);
    expect(Number(l1!.events_nulled)).toBe(1);
    expect(
      l1!.moved_events.some((m) => Number(m.event_id) === liveEvent.id),
    ).toBe(true);
    expect(l1!.loser_row.config).toMatchObject({ minPlayers: 3 });
    expect(l2!.loser_row.config).toMatchObject({ autoClose: true });
    expect(Number(l2!.events_repointed)).toBe(0);

    // Recreating the indexes now succeeds — proof no duplicates remain.
    for (const c of stmts.createIndexes) {
      await testApp.db.execute(sql.raw(c));
    }

    // Re-running the block is a no-op at the binding + audit-row level.
    await runDedupe();
    const afterRerun = await testApp.db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.channelId, CHANNEL));
    expect(afterRerun).toHaveLength(1);
    const [{ c: auditCount }] = [
      ...(await testApp.db.execute<{ c: number }>(
        sql`SELECT count(*)::int AS c FROM channel_bindings_dedup_audit`,
      )),
    ];
    expect(Number(auditCount)).toBe(2);
  });
});

describe('ROK-1419 (B2-3) restore path — rebuild loser + re-link the moved event', () => {
  it('restores the deleted binding with its original id/config/created_at and re-points the moved event', async () => {
    await dropIndexes();
    const game = testApp.seed.game;
    const admin = testApp.seed.adminUser;

    const [survivor] = await testApp.db
      .insert(schema.channelBindings)
      .values(
        monitorRow(
          new Date('2026-07-01T00:00:00Z'),
          new Date('2026-01-01T00:00:00Z'),
        ),
      )
      .returning();
    const [loser] = await testApp.db
      .insert(schema.channelBindings)
      .values(
        monitorRow(
          new Date('2026-06-01T00:00:00Z'),
          new Date('2026-02-01T00:00:00Z'),
          {
            minPlayers: 3,
          },
        ),
      )
      .returning();
    await testApp.db
      .update(schema.channelBindings)
      .set({ gameId: game.id })
      .where(eq(schema.channelBindings.channelId, CHANNEL));

    const now = Date.now();
    const [liveEvent] = await testApp.db
      .insert(schema.events)
      .values({
        title: 'live ad-hoc',
        creatorId: admin.id,
        isAdHoc: true,
        channelBindingId: loser.id,
        duration: [new Date(now - 30 * 60_000), new Date(now + 30 * 60_000)],
      })
      .returning();

    await runDedupe();

    // Sanity: loser deleted, live event moved to the survivor.
    const gone = await testApp.db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.id, loser.id));
    expect(gone).toHaveLength(0);
    const [movedLive] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, liveEvent.id));
    expect(movedLive.channelBindingId).toBe(survivor.id);

    // Run the operator restore runbook exactly as documented in the header.
    const restore = extractRestoreSql(stmts.raw);
    await testApp.db.execute(sql.raw(restore.restoreBindings));
    await testApp.db.execute(sql.raw(restore.restoreLinkage));

    // Binding returns with its ORIGINAL id, config and created_at.
    const [loserBack] = await testApp.db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.id, loser.id));
    expect(loserBack).toBeDefined();
    expect(loserBack.config).toMatchObject({ minPlayers: 3 });
    expect(
      Math.abs(loserBack.createdAt.getTime() - loser.createdAt.getTime()),
    ).toBeLessThan(1000);

    // moved_events × loser_binding_id re-points the live event back to the loser.
    const [liveRestored] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, liveEvent.id));
    expect(liveRestored.channelBindingId).toBe(loser.id);
  });
});

describe('ROK-1419 (B2-4) validateMigrationState flags an absent critical index', () => {
  afterEach(async () => {
    if (!stmts) return;
    for (const c of stmts.createIndexes) {
      await testApp.db.execute(sql.raw(c));
    }
  });

  it('warns when channel_bindings_nonseries_game_unique is missing though its hash is applied', async () => {
    await testApp.db.execute(
      sql.raw('DROP INDEX IF EXISTS "channel_bindings_nonseries_game_unique"'),
    );
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await validateMigrationState(testApp._appClient, MIGRATIONS_DIR);
    } finally {
      warnSpy.mockRestore();
    }
    const warned = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(warned).toMatch(/channel_bindings_nonseries_game_unique/);
  });
});
