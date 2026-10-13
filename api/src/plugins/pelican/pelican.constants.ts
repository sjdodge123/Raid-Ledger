/** Plugin slug — the `plugins` row and manifest id (ROK-121). */
export const PELICAN_PLUGIN_ID = 'pelican';
/** Integration key on the manifest (admin panel route segment). */
export const PELICAN_INTEGRATION_KEY = 'pelican-panel';
/** Every Pelican HTTP call aborts after this long. */
export const PELICAN_HTTP_TIMEOUT_MS = 10_000;
/** Pelican caps `per_page` on `GET /api/client` at 100. */
export const PELICAN_MAX_PER_PAGE = 100;
