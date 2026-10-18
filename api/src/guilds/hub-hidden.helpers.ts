import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { isStaff, type GuildActor } from './guild-access.service';

type Db = PostgresJsDatabase<typeof schema>;

/** The message every hidden-hub refusal carries (indistinguishable from missing). */
export const HUB_NOT_FOUND = 'Guild not found';

/** The guild's `hidden_at`, or undefined when the guild does not exist. */
export async function findHiddenAt(
  db: Db,
  guildId: number,
): Promise<Date | null | undefined> {
  const [row] = await db
    .select({ hiddenAt: schema.guilds.hiddenAt })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  return row === undefined ? undefined : row.hiddenAt;
}

/**
 * ROK-1831 L-5: a hidden hub answers 404 to everyone but staff, exactly as a
 * missing one would. A missing guild passes through — the handler owns that 404.
 */
export async function assertNotHidden(
  db: Db,
  actor: GuildActor,
  guildId: number,
): Promise<void> {
  if (isStaff(actor)) return;
  const hiddenAt = await findHiddenAt(db, guildId);
  if (hiddenAt !== null && hiddenAt !== undefined) {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
}

/** Set (`hidden: true`) or clear `guilds.hidden_at`; false when no such guild. */
export async function setHubHidden(
  db: Db,
  guildId: number,
  hidden: boolean,
): Promise<boolean> {
  const rows = await db
    .update(schema.guilds)
    .set({ hiddenAt: hidden ? new Date() : null })
    .where(eq(schema.guilds.id, guildId))
    .returning({ id: schema.guilds.id });
  return rows.length > 0;
}
