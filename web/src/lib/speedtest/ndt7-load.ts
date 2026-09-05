/**
 * The ONLY place `@m-lab/ndt7-js` is imported (O5).
 *
 * It lives in its own leaf module so the dynamic import is a separate chunk
 * and so nothing that merely *imports the runner* pulls M-Lab into its graph —
 * the module is fetched at the moment a user asks for a measurement, never
 * before.
 */
export function loadNdt7(): Promise<unknown> {
    return import('@m-lab/ndt7-js');
}
