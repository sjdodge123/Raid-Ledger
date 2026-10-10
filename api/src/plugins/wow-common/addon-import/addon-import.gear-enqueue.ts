import type { Logger } from '@nestjs/common';
import type { WowItemMetaService } from '../wowhead-item/wow-item-meta.service';
import type { DecodedAddonPaste } from './addon-import.decoder';

/** The result fields both import routes share. */
interface ImportOutcome {
  status?: string;
  section?: string;
  sections?: { section: string; status: string }[];
}

/**
 * ROK-1727: resolve the char section's gear item ids when that section
 * applied. Call AFTER the import tx committed; fire-and-forget and
 * best-effort — it must never fail an import that landed.
 */
export function enqueueAppliedGear(
  itemMeta: Pick<WowItemMetaService, 'enqueue'>,
  paste: DecodedAddonPaste,
  res: ImportOutcome,
  logger: Pick<Logger, 'warn'>,
): void {
  const warn = (err: unknown) =>
    logger.warn(`Wowhead gear enqueue failed: ${String(err)}`);
  try {
    const charStatus =
      res.sections?.find((s) => s.section === 'char')?.status ??
      (res.section === 'char' ? res.status : undefined);
    if (charStatus !== 'applied') return;
    const gear = paste.sections.char?.payload.data.gear ?? [];
    const ids = gear.flatMap((g) => (g.itemId ? [g.itemId] : []));
    if (ids.length > 0) itemMeta.enqueue(ids).catch(warn);
  } catch (err: unknown) {
    warn(err);
  }
}
