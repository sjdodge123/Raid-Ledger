/**
 * ROK-2137 — `POST /admin/test/wow/seed-guild-game-text`: store an in-game
 * MOTD / Guild Information REPORT on a guild, exactly as a LedgerLink guild
 * export would (`applyGuildGameText`), then clear the field's Push
 * acknowledgement so the editor's "Changed in game" notice is raised again.
 * Lets the smoke + fleet test plan drive Adopt / Keep without an addon string.
 */
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AddonGuildData } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { applyGuildGameText } from '../plugins/wow-common/addon-import/addon-import-guild.game-text';
import type { GameTextRow } from '../plugins/wow-common/guilds/guild-ingame-game-text.helpers';
import { findGameText } from '../plugins/wow-common/guilds/guild-ingame-game-text.queries';
import type { Db } from '../plugins/wow-common/guilds/guild-ingame-text.queries';

/** Body: at least one of `motd` / `info` (`''` = the in-game box is empty). */
export const SeedGuildGameTextSchema = z
  .object({
    guildId: z.number().int().positive(),
    motd: z.string().max(255).optional(),
    info: z.string().max(499).optional(),
    /** ISO instant of the report; default now. An older one than stored is ignored. */
    reportedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((b) => b.motd !== undefined || b.info !== undefined, {
    message: 'motd or info is required',
  });
export type SeedGuildGameTextInput = z.infer<typeof SeedGuildGameTextSchema>;

/** The fixture body → the export `data` keys `applyGuildGameText` reads. */
export function gameTextData(
  input: SeedGuildGameTextInput,
): Pick<AddonGuildData, 'motd' | 'infoText'> {
  return {
    ...(input.motd !== undefined ? { motd: input.motd } : {}),
    ...(input.info !== undefined ? { infoText: input.info } : {}),
  };
}

async function assertGuildExists(db: Db, guildId: number): Promise<void> {
  const [row] = await db
    .select({ id: schema.guilds.id })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);
  if (!row) throw new NotFoundException(`guild ${guildId} not found`);
}

/** Clears the Push acknowledgement of each field the body reported. */
async function clearAcknowledged(
  db: Db,
  input: SeedGuildGameTextInput,
): Promise<void> {
  await db
    .update(schema.guildProfiles)
    .set({
      ...(input.motd !== undefined ? { gameMotdAcknowledgedAt: null } : {}),
      ...(input.info !== undefined ? { gameInfoAcknowledgedAt: null } : {}),
    })
    .where(eq(schema.guildProfiles.guildId, input.guildId));
}

/** Store the report + clear its acknowledgement; returns the stored state. */
export async function seedGuildGameText(
  db: Db,
  input: SeedGuildGameTextInput,
): Promise<GameTextRow> {
  await assertGuildExists(db, input.guildId);
  const reportedAt = input.reportedAt ? new Date(input.reportedAt) : new Date();
  await applyGuildGameText(
    { tx: db },
    input.guildId,
    gameTextData(input),
    reportedAt,
  );
  await clearAcknowledged(db, input);
  const row = await findGameText(db, input.guildId);
  if (!row)
    throw new Error(`guild ${input.guildId} has no profile row after seeding`);
  return row;
}
