/**
 * ROK-1621 — one-off cleanup for phantom "Awaiting player" guest slots.
 *
 * Before the fix, merely copying a share invite link POSTed an anonymous
 * `pug_slots` row (`discord_username IS NULL`, `status = 'pending'`). Nobody
 * was ever invited, and every cleanup path keys on identity the row does not
 * have, so the row renders as "Awaiting player · Pending" forever.
 *
 * This script is REPORT-ONLY by default. It prints exactly what it would
 * delete and deletes nothing unless `--apply` is passed.
 *
 *   npx ts-node scripts/cleanup-phantom-invite-slots.ts              # count only
 *   npx ts-node scripts/cleanup-phantom-invite-slots.ts --apply      # past events only
 *   npx ts-node scripts/cleanup-phantom-invite-slots.ts --apply --include-upcoming
 *
 * Operator-run maintenance script — not part of the boot/deploy path.
 */
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { sql, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as dotenv from 'dotenv';
import {
  DrizzleModule,
  DrizzleAsyncProvider,
} from '../src/drizzle/drizzle.module';
import * as schema from '../src/drizzle/schema';

dotenv.config();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DrizzleModule,
  ],
})
class CleanupModule {}

type Db = PostgresJsDatabase<typeof schema>;

interface PhantomRow extends Record<string, unknown> {
  id: string;
  eventId: number;
  eventTitle: string;
  inviteCode: string | null;
  createdAt: Date;
  ended: boolean;
}

/**
 * Every anonymous, never-contacted, never-claimed pending slot — the exact
 * shape a "copy the link" click produced.
 */
async function findPhantoms(db: Db): Promise<PhantomRow[]> {
  const rows = await db.execute<PhantomRow>(sql`
        SELECT p.id            AS "id",
               p.event_id      AS "eventId",
               e.title         AS "eventTitle",
               p.invite_code   AS "inviteCode",
               p.created_at    AS "createdAt",
               (upper(e.duration) < now()) AS "ended"
        FROM pug_slots p
        JOIN events e ON e.id = p.event_id
        WHERE p.discord_username IS NULL
          AND p.discord_user_id IS NULL
          AND p.claimed_by_user_id IS NULL
          AND p.status = 'pending'
        ORDER BY e.id, p.created_at
    `);
  return Array.from(rows as unknown as PhantomRow[]);
}

/** Print the full inventory so the operator can eyeball it before `--apply`. */
function report(phantoms: PhantomRow[]): void {
  const ended = phantoms.filter((p) => p.ended);
  console.log(`\nPhantom guest slots found: ${phantoms.length}`);
  console.log(
    `  on events that have ENDED   : ${ended.length}  (safe to delete)`,
  );
  console.log(
    `  on events still UPCOMING    : ${phantoms.length - ended.length}  (their links may have been shared)`,
  );
  for (const p of phantoms) {
    const when = p.ended ? 'ended' : 'upcoming';
    console.log(
      `  - slot ${p.id} · event ${p.eventId} "${p.eventTitle}" (${when}) · code ${p.inviteCode ?? 'none'}`,
    );
  }
}

/** Delete the selected phantoms by primary key — never a blanket predicate. */
async function deletePhantoms(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await db
    .delete(schema.pugSlots)
    .where(inArray(schema.pugSlots.id, ids))
    .returning({ id: schema.pugSlots.id });
  return deleted.length;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const includeUpcoming = process.argv.includes('--include-upcoming');
  const app = await NestFactory.createApplicationContext(CleanupModule, {
    logger: ['error'],
  });
  try {
    const db = app.get<Db>(DrizzleAsyncProvider);
    const phantoms = await findPhantoms(db);
    report(phantoms);
    const targets = phantoms.filter((p) => includeUpcoming || p.ended);
    if (!apply) {
      console.log(
        `\nDRY RUN — would delete ${targets.length} slot(s). Re-run with --apply to proceed.\n`,
      );
      return;
    }
    const deleted = await deletePhantoms(
      db,
      targets.map((p) => p.id),
    );
    console.log(`\nDeleted ${deleted} phantom guest slot(s).\n`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error('cleanup-phantom-invite-slots failed:', err);
  process.exit(1);
});
