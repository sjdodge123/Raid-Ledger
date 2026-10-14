/** Plugin slug — the `plugins` row and manifest id (ROK-121). */
export const PELICAN_PLUGIN_ID = 'pelican';
/** Integration key on the manifest (admin panel route segment). */
export const PELICAN_INTEGRATION_KEY = 'pelican-panel';
/** Every Pelican HTTP call aborts after this long. */
export const PELICAN_HTTP_TIMEOUT_MS = 10_000;
/** Pelican caps `per_page` on `GET /api/client` at 100. */
export const PELICAN_MAX_PER_PAGE = 100;
/** Server sync tick — every 15 minutes (ROK-1772). */
export const PELICAN_SYNC_CRON = '0 */15 * * * *';
/** Status poll tick — every 2 minutes (ROK-1772). */
export const PELICAN_STATUS_CRON = '0 */2 * * * *';
/** At most this many `/resources` calls in flight (D6). */
export const PELICAN_STATUS_CONCURRENCY = 4;
/** A server checked this recently is skipped — honours the panel's cache. */
export const PELICAN_STATUS_FRESH_MS = 20_000;
/** A status older than this reads `unknown` (3 missed ticks, ruling Q4). */
export const PELICAN_STATUS_STALE_MS = 6 * 60_000;
/** Label the host stamps onto every Pelican status/item. */
export const PELICAN_PROVIDER_LABEL = 'Pelican';
/** At most this many `/schedules` calls in flight (ROK-1773 D3). */
export const PELICAN_SCHEDULE_CONCURRENCY = 4;
/** Stored schedule names are cut to this length (mirrors server names). */
export const PELICAN_SCHEDULE_NAME_MAX = 200;
/** At most this many in-range schedule occurrences per server per calendar request (ROK-1096 D5). */
export const PELICAN_PROJECTION_CAP = 500;
/** A stored `next_run_at` within this of a cron occurrence counts as one (ROK-1096 D10). */
export const PELICAN_TZ_TOLERANCE_MS = 60_000;
