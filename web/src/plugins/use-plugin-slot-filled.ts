import { usePluginStore } from '../stores/plugin-store';
import { getSlotRegistrations, type PluginSlotName } from './plugin-registry';

/**
 * ROK-2357 — does an ACTIVE plugin fill `name`? Lets core hide the copy and
 * controls around a slot (a heading, a "skip" link) when nothing would render
 * in it, with the same active filter `PluginSlot` applies.
 */
export function usePluginSlotFilled(name: PluginSlotName): boolean {
    const activeSlugs = usePluginStore((s) => s.activeSlugs);
    return getSlotRegistrations(name).some((r) => activeSlugs.has(r.pluginSlug));
}
