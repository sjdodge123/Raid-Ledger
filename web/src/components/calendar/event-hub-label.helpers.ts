import type { EventHubRef } from '@raid-ledger/contract';

/** The plain-text suffix for a `title` / `aria-label`: ` · <hub>`, or `''` when untagged/hidden. */
export function hubSuffixText(hub: EventHubRef | null | undefined): string {
    return hub ? ` · ${hub.name}` : '';
}
