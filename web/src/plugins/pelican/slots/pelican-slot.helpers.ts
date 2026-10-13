/** Slot-gate helpers shared by the eager gate and the lazy Pelican panel (ROK-121). */
export const PELICAN_INTEGRATION_KEY = 'pelican-panel';

/** True only for the Pelican plugin's own integration card. */
export function isPelicanSlot(pluginSlug?: string, integrationKey?: string): boolean {
    if (pluginSlug !== 'pelican') return false;
    return !integrationKey || integrationKey === PELICAN_INTEGRATION_KEY;
}
