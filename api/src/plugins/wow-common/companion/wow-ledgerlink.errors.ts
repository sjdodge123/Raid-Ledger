/**
 * ROK-1964 §6.2 — an addon-import reject → a companion ingest error with a
 * pinned wire code. `RATE_LIMITED` → `rate_limited` (429, retryable),
 * `TOO_LARGE` → `payload_too_large` (413), every other addon code →
 * `invalid_payload` (400, terminal). The body is fixed copy plus the addon
 * code as one `issues` entry — never the import's message text, the export
 * string or a decoded value. No new wire code day 1.
 */
import type { HttpException } from '@nestjs/common';
import type { AddonImportErrorCode } from '@raid-ledger/contract';
import { companionError } from '../../../companion/ingest/companion-ingest.errors';
import { AddonImportError } from '../addon-import/addon-import.errors';

/** Where the rejected value lives in a `wow-ledgerlink` message. */
export const WOW_LEDGERLINK_EXPORT_PATH = 'payload.exportString';

/** Fixed copy per wire code (never the addon's own message). */
export const WOW_LEDGERLINK_REJECT_MESSAGES = Object.freeze({
  rate_limited: 'Too many imports — try again later',
  payload_too_large: 'The export is too large to import',
  invalid_payload: 'The export could not be imported',
});

/** The companion error for one addon-import reject code. */
export function companionErrorForImportCode(
  code: AddonImportErrorCode,
): HttpException {
  const issues = [{ path: WOW_LEDGERLINK_EXPORT_PATH, code }];
  if (code === 'RATE_LIMITED') {
    return companionError(
      'rate_limited',
      WOW_LEDGERLINK_REJECT_MESSAGES.rate_limited,
      { issues },
    );
  }
  if (code === 'TOO_LARGE') {
    return companionError(
      'payload_too_large',
      WOW_LEDGERLINK_REJECT_MESSAGES.payload_too_large,
      { issues },
    );
  }
  return companionError(
    'invalid_payload',
    WOW_LEDGERLINK_REJECT_MESSAGES.invalid_payload,
    { issues },
  );
}

/**
 * What the handler rethrows: an `AddonImportError` (incl. `RosterHeldError`)
 * becomes its companion error; anything else passes through unchanged (the
 * global filter answers 500 without echoing it).
 */
export function companionErrorForImport(err: unknown): unknown {
  return err instanceof AddonImportError
    ? companionErrorForImportCode(err.code)
    : err;
}
