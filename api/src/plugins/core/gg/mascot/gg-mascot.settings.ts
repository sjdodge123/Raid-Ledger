import {
  GgMascotSchema,
  type GgMascot,
  type GgOwnerMascot,
} from '@raid-ledger/contract';
import { SETTING_KEYS } from '../../../../drizzle/schema';
import type { SettingsService } from '../../../../settings/settings.service';

/**
 * ROK-2187 — the `GG_MASCOT` app-setting (JSON `GgMascot`). Unset, unparsable
 * or schema-invalid ⇒ `null` (plain intro) — a bad row never breaks a GG.
 */

type SettingsReader = Pick<SettingsService, 'get'>;
type SettingsWriter = Pick<SettingsService, 'set' | 'delete'>;

/**
 * The community mascot, or `null`. The owner GG controller calls this (then
 * {@link toOwnerMascot}) to fill `GgOwnerSnapshotDto.mascot`.
 */
export async function readGgMascot(settings: SettingsReader): Promise<GgMascot | null> {
  const raw = await settings.get(SETTING_KEYS.GG_MASCOT);
  if (!raw) return null;
  try {
    const parsed = GgMascotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The owner-read slice (`emojiName, imageUrl, soundUrl, volume`), or `null`. */
export function toOwnerMascot(mascot: GgMascot | null): GgOwnerMascot | null {
  if (!mascot) return null;
  const { emojiName, imageUrl, soundUrl, volume } = mascot;
  return { emojiName, imageUrl, soundUrl, volume };
}

/** Stores (or with `null`, deletes) the `GG_MASCOT` row. */
export async function writeGgMascot(settings: SettingsWriter, mascot: GgMascot | null): Promise<void> {
  if (!mascot) {
    await settings.delete(SETTING_KEYS.GG_MASCOT);
    return;
  }
  await settings.set(SETTING_KEYS.GG_MASCOT, JSON.stringify(mascot));
}
