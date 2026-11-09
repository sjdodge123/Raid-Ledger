/**
 * ROK-2143: helpers for the crawl's evidence-only probes (the sample quest of
 * a skipped dungeon, M1; the classic item-level lookup, R8=B). A probe never
 * fails the run: a thrown request becomes an error line and HTTP 0. Only the
 * kill switch still stops the run — that is the operator's stop.
 */
import {
  isQuestImportOff,
  pushQuestImportError,
  type ForeverQuestImportReport,
} from './forever-quest-import.report';

/**
 * Catch handler for a probe request: rethrows the kill-switch abort, records
 * anything else as `<label>: <message>` and resolves to null (no response).
 */
export function recordProbeFailure(
  report: ForeverQuestImportReport,
  label: string,
  e: unknown,
): null {
  if (isQuestImportOff(e)) throw e;
  const why = e instanceof Error ? e.message : String(e);
  pushQuestImportError(report, `${label}: ${why}`);
  return null;
}

/** `level` of a classic item response, else null. */
export function itemLevelOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('level' in body)) {
    return null;
  }
  return typeof body.level === 'number' ? body.level : null;
}
