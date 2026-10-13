import type {
  PelicanStatusPollSummary,
  PelicanSyncCode,
  PelicanSyncResult,
} from '@raid-ledger/contract';
import type { PelicanSyncOutcome } from './pelican-sync.helpers';
import { pelicanTestMessage } from './pelican-test-messages';

/** Admin-facing copy for one "Sync now" outcome (ROK-1772). */
export function pelicanSyncMessage(
  outcome: PelicanSyncOutcome,
  status: PelicanStatusPollSummary | null,
): string {
  const code: PelicanSyncCode = outcome.code;
  switch (code) {
    case 'ok': {
      const polled =
        status === null ? '' : ` Status checked for ${status.polled}.`;
      return `Synced ${outcome.upserted} server(s): ${outcome.markedMissing} newly missing, ${outcome.restored} restored.${polled}`;
    }
    case 'in_progress':
      return 'A sync is already running. Try again in a moment.';
    case 'partial_listing':
      return 'The panel returned an incomplete server list, so nothing was changed. Try again.';
    case 'internal_error':
      return 'The sync failed unexpectedly. Check the server logs.';
    default:
      return pelicanTestMessage(code);
  }
}

/** The `POST /admin/plugins/pelican/sync` body. */
export function toPelicanSyncResult(
  outcome: PelicanSyncOutcome,
  status: PelicanStatusPollSummary | null,
): PelicanSyncResult {
  return {
    code: outcome.code,
    message: pelicanSyncMessage(outcome, status),
    upserted: outcome.upserted,
    markedMissing: outcome.markedMissing,
    restored: outcome.restored,
    status,
  };
}
