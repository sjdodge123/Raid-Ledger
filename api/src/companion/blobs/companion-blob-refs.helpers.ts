/**
 * ROK-1956 D-15 — pure ref checks shared by the upload route (step 10) and
 * the messages transaction (steps 11b / 11d). A ref and a blob agree when
 * `byteLength`, `width` and `height` all match, in either arrival order.
 */
import type { CompanionWebpRef } from '@raid-ledger/contract';
import { companionError } from '../ingest/companion-ingest.errors';
import type { CompanionBlobDims } from './companion-blobs.repository';

/** A ref as stored in `companion_blob_refs` (content type is always WebP). */
export type CompanionBlobRefRow = CompanionBlobDims & { sha256: string };

/** Every ref must agree with `got`. */
export function refsAgree(
  refs: readonly CompanionBlobDims[],
  got: CompanionBlobDims,
): boolean {
  return refs.every(
    (r) =>
      r.byteLength === got.byteLength &&
      r.width === got.width &&
      r.height === got.height,
  );
}

/** 409 `blob_ref_mismatch`. */
export function blobRefMismatch(): Error {
  return companionError('blob_ref_mismatch', 'Blob differs from a message ref');
}

/**
 * One row per sha (the upsert must not touch a row twice); two refs to the
 * same sha that disagree are a 409.
 */
export function uniqueBlobRefs(
  refs: readonly CompanionWebpRef[],
): CompanionBlobRefRow[] {
  const bySha = new Map<string, CompanionBlobRefRow>();
  for (const { sha256, byteLength, width, height } of refs) {
    const row = { sha256, byteLength, width, height };
    const seen = bySha.get(sha256);
    if (seen && !refsAgree([seen], row)) throw blobRefMismatch();
    bySha.set(sha256, row);
  }
  return [...bySha.values()];
}

/** Step 11b: each already-stored blob must agree with the message's ref. */
export function assertRefsMatchStored(
  refs: readonly CompanionBlobRefRow[],
  stored: readonly CompanionBlobRefRow[],
): void {
  const want = new Map(refs.map((r) => [r.sha256, r]));
  for (const blob of stored) {
    const ref = want.get(blob.sha256);
    if (ref && !refsAgree([ref], blob)) throw blobRefMismatch();
  }
}
