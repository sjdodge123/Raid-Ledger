import {
  GuildCrestPresetSchema,
  type GuildCrest,
  type GuildCrestEditorState,
  type GuildCrestPreset,
  type GuildCrestUploadUrls,
} from '@raid-ledger/contract';
import { crestPublicUrl, isGuildCrestKey } from './hub-crest.paths';

/**
 * The `guilds` crest columns the resolver reads (structural, so a full
 * `GuildSelect` row satisfies it once the migration adds the columns).
 * `crestActive` is the CHECK-constrained varchar: 'upload' | 'preset' | null.
 */
export interface GuildCrestColumns {
  id: number;
  crestActive: string | null;
  crestUploadKey: string | null;
  crestPreset: GuildCrestPreset | null;
  crestRemovedAt: Date | null;
}

/** The stored upload's public URLs, or null when absent or malformed. */
function storedUpload(row: GuildCrestColumns): GuildCrestUploadUrls | null {
  const key = row.crestUploadKey;
  if (!key || !isGuildCrestKey(key)) return null;
  return {
    urlSm: crestPublicUrl(row.id, key, 'sm'),
    urlLg: crestPublicUrl(row.id, key, 'lg'),
  };
}

/** The stored preset, or null when absent or stale (an id the palette dropped). */
function storedPreset(row: GuildCrestColumns): GuildCrestPreset | null {
  const parsed = GuildCrestPresetSchema.safeParse(row.crestPreset);
  return parsed.success ? parsed.data : null;
}

/**
 * ROK-1814 — the crest a hub shows (`GuildSummary.crest`): the active upload,
 * else (an upload a staff member removed) the stored preset, or the active
 * preset; anything else → null (initials / shield).
 * ROK-1170 seam: a synced Blizzard crest is checked FIRST here and wins.
 */
export function resolveGuildCrest(row: GuildCrestColumns): GuildCrest | null {
  const upload = storedUpload(row);
  const preset = storedPreset(row);
  if (row.crestActive === 'upload' && upload)
    return { source: 'upload', ...upload };
  if (row.crestActive === 'upload' || row.crestActive === 'preset') {
    return preset ? { source: 'preset', ...preset } : null;
  }
  return null;
}

/** `GET /guilds/:id/crest` — both stored crests, the effective pointer, the staff removal time. */
export function buildGuildCrestEditorState(
  row: GuildCrestColumns,
): GuildCrestEditorState {
  const shown = resolveGuildCrest(row);
  return {
    active: shown ? shown.source : null,
    upload: storedUpload(row),
    preset: storedPreset(row),
    removedByStaffAt: row.crestRemovedAt
      ? row.crestRemovedAt.toISOString()
      : null,
  };
}
