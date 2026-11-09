import { eq } from 'drizzle-orm';
import { guildMailworthyGivers } from '../../../drizzle/schema';
import type { AddonApplyContext } from './addon-import-apply.types';
import { previewChar } from './addon-import-char.apply';
import { findGuildId, loadRoster } from './addon-import-char.mailworthy';
import { anyGiverNewer } from './addon-import-char.mailworthy.helpers';
import { exportClock } from './addon-import.clock';
import type { DecodedAddonCharExport } from './addon-import.decoder';

/**
 * ROK-2148 (Codex P2) — the char preview. A `stale` / `noop` char snapshot
 * still previews as `preview` (applicable) when its Mailworthy block carries
 * a giver that outranks the stored row (amended-D5 source, then `asOf` /
 * `generatedAt` — the write path's rule): the apply then writes it but
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
  const block = payload.mailworthy;
  if (!block || (block.givers ?? []).length === 0) return false;
  const guildName = payload.who.guildName;
  if (!guildName) return false;
  const guildId = await findGuildId(ctx, guildName);
  if (guildId === undefined) return false;
  const roster = await loadRoster(ctx, guildId, payload.who.guid);
  const t = guildMailworthyGivers;
  const rows = await ctx.tx
    .select({
      nameKey: t.nameKey,
      source: t.source,
      asOf: t.asOf,
      generatedAt: t.generatedAt,
    })
    .from(t)
    .where(eq(t.guildId, guildId));
  const stored = new Map(rows.map(({ nameKey, ...rank }) => [nameKey, rank]));
  const nowMs = exportClock.nowMs();
  return anyGiverNewer({ block, roster, userId: ctx.userId, stored, nowMs });
}
