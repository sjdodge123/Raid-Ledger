import type { SetGuildCrest } from '@raid-ledger/contract';
import type { CrestPatch, CrestRow } from './hub-crest.queries';

/** ROK-1814 — pure patch builders for the crest columns. */

/** A new upload: point at it and clear any staff removal. */
export function uploadPatch(
  key: string,
  actorId: number,
  now: Date,
): CrestPatch {
  return {
    crestUploadKey: key,
    crestActive: 'upload',
    crestSetBy: actorId,
    crestSetAt: now,
    crestRemovedBy: null,
    crestRemovedAt: null,
  };
}

/**
 * `PUT /crest`: save + show a preset, show the stored upload, or show
 * nothing. Null when `{active:'upload'}` has no stored upload to show.
 */
export function setPatch(
  body: SetGuildCrest,
  row: CrestRow,
  actorId: number,
  now: Date,
): CrestPatch | null {
  const stamp = { crestSetBy: actorId, crestSetAt: now };
  if (body.active === 'preset') {
    return { ...stamp, crestActive: 'preset', crestPreset: body.preset };
  }
  if (body.active === 'upload') {
    return row.crestUploadKey ? { ...stamp, crestActive: 'upload' } : null;
  }
  return { ...stamp, crestActive: null };
}

/**
 * Staff removal of the upload: drop the key, record who/when, and fall
 * back to the stored preset (else nothing) when the upload was showing.
 * Null when there is no upload to remove.
 */
export function removeUploadPatch(
  row: CrestRow,
  actorId: number,
  now: Date,
): CrestPatch | null {
  if (!row.crestUploadKey) return null;
  const fallback = row.crestPreset ? 'preset' : null;
  return {
    crestUploadKey: null,
    crestRemovedBy: actorId,
    crestRemovedAt: now,
    crestActive: row.crestActive === 'upload' ? fallback : row.crestActive,
  };
}
