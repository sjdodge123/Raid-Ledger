import { eq } from 'drizzle-orm';
import { guildMailworthyGivers } from '../../../drizzle/schema';
import type { AddonApplyContext } from './addon-import-apply.types';
import { previewChar } from './addon-import-char.apply';
import { findGuildId } from './addon-import-char.mailworthy';
import { anyGiverNewer } from './addon-import-char.mailworthy.helpers';
import { exportClock } from './addon-import.clock';
import type { DecodedAddonCharExport } from './addon-import.decoder';

/**
 * ROK-2148 (Codex P2) — the char preview. A `stale` / `noop` char snapshot
 * still previews as `preview` (applicable) when its Mailworthy block carries
 * a giver newer than the stored row: the apply then writes the givers but
 * never the older snapshot or the binding (`applyChar` / `shouldApplyBinding`
 * keep it `stale`). Template and peers alone do not make it applicable.
 */
export async function previewCharThenMailworthy(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<Awaited<ReturnType<typeof previewChar>>> {
  const outcome = await previewChar(ctx, payload);
  if (outcome.status === 'preview') return outcome;
  if (!(await hasNewerGivers(ctx, payload))) return outcome;
  return { ...outcome, status: 'preview' };
}

async function hasNewerGivers(
  ctx: AddonApplyContext,
  payload: DecodedAddonCharExport,
): Promise<boolean> {
  const givers = payload.mailworthy?.givers ?? [];
  if (givers.length === 0) return false;
  const guildName = payload.who.guildName;
  if (!guildName) return false;
  const guildId = await findGuildId(ctx, guildName);
  if (guildId === undefined) return false;
  const rows = await ctx.tx
    .select({
      nameKey: guildMailworthyGivers.nameKey,
      asOf: guildMailworthyGivers.asOf,
    })
    .from(guildMailworthyGivers)
    .where(eq(guildMailworthyGivers.guildId, guildId));
  const stored = new Map(rows.map((r) => [r.nameKey, r.asOf]));
  return anyGiverNewer(givers, stored, exportClock.nowMs());
}
