/**
 * ROK-2124 — the Forever Armory auto-link's Nest classes, spread into
 * `WowCommonModule` (keeps that module under the 300-line limit).
 */
import { ForeverAutoLinkService } from './forever-auto-link.service';

/** Link attempt (import nudge) + hourly retry/backfill job body. */
export const PROVIDERS = [ForeverAutoLinkService];
