import { NotFoundException } from '@nestjs/common';
import { eq, inArray, isNotNull, and } from 'drizzle-orm';
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
  if (await isHiddenFrom(db, actor, guildId)) {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
}

/** True when the hub is hidden and the actor is not staff (L-5). */
export async function isHiddenFrom(
  db: Db,
  actor: GuildActor,
  guildId: number,
): Promise<boolean> {
  if (isStaff(actor)) return false;
  const hiddenAt = await findHiddenAt(db, guildId);
  return hiddenAt !== null && hiddenAt !== undefined;
}

/** L-5 list filter: staff see every hub, everyone else loses the hidden ones. */
export async function dropHiddenFor<T extends { id: number }>(
  db: Db,
  actor: GuildActor,
  hubs: T[],
): Promise<T[]> {
  if (isStaff(actor) || hubs.length === 0) return hubs;
  const g = schema.guilds;
  const rows = await db
    .select({ id: g.id })
    .from(g)
    .where(
      and(
        inArray(
          g.id,
          hubs.map((h) => h.id),
        ),
        isNotNull(g.hiddenAt),
      ),
    );
  const hidden = new Set(rows.map((r) => r.id));
  return hubs.filter((h) => !hidden.has(h.id));
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
