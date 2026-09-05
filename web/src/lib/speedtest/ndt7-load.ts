/**
 * The ONLY place `@m-lab/ndt7` is imported (O5).
 *
 * It lives in its own leaf module so the dynamic import is a separate chunk
 * and so nothing that merely *imports the runner* pulls M-Lab into its graph —
 * the module is fetched at the moment a user asks for a measurement, never
 * before.
 *
 * It also owns the Worker url. ndt7 builds its download worker with
 * `new Worker(config.downloadworkerfile || 'ndt7-download-worker.js')` — a
 * PAGE-relative url, which on a SPA route resolves to something that is not the
 * worker, so without an explicit url a measurement dies on the first Worker
 * construction and no figure can ever be produced. The worker is therefore
 * served from `public/` (see `web/public/ndt7-download-worker.js` for why it is
 * vendored rather than bundled) and handed over as `downloadworkerfile`.
 */

/** Filename of the vendored worker as served from the public directory. */
const DOWNLOAD_WORKER_FILE = 'ndt7-download-worker.js';

/**
 * Absolute url of ndt7's download worker — never page-relative.
 *
 * Built from `BASE_URL` so a deployment served under a sub-path still resolves.
 */
export function ndt7DownloadWorkerUrl(): string {
    return `${import.meta.env.BASE_URL}${DOWNLOAD_WORKER_FILE}`;
}

/** Dynamically import the M-Lab client. Resolves to the ndt7 module. */
export function loadNdt7(): Promise<unknown> {
    return import('@m-lab/ndt7');
}
