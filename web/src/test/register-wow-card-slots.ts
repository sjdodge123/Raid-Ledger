/**
 * ROK-2359 test helper: core card specs render the real WoW class-icon and
 * profession slots, the way `plugins/wow/register.ts` wires them, with the
 * `blizzard` plugin active (or not — `active: false` proves the slots hide).
 */
import { registerSlotComponent } from '../plugins/plugin-registry';
import { CharacterClassIcon } from '../plugins/wow/slots/character-class-icon';
import { CharacterProfessions } from '../plugins/wow/slots/character-professions';
import { usePluginStore } from '../stores/plugin-store';

export function registerWowCardSlots({ active = true }: { active?: boolean } = {}): void {
    registerSlotComponent({ pluginSlug: 'blizzard', slotName: 'character-card:class-icon', component: CharacterClassIcon, priority: 0 });
    registerSlotComponent({ pluginSlug: 'blizzard', slotName: 'character-card:professions', component: CharacterProfessions, priority: 0 });
    usePluginStore.getState().setActiveSlugs(active ? ['blizzard'] : []);
}
