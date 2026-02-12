import { registerSlotComponent } from '../plugin-registry';
import { CharacterDetailSections } from './slots/character-detail-sections';
import { CharacterDetailHeaderBadges } from './slots/character-detail-header-badges';
import { CharacterCreateImportForm } from './slots/character-create-import-form';
import { CharacterCreateInlineImport } from './slots/character-create-inline-import';
import { EventCreateContentBrowser } from './slots/event-create-content-browser';
import { EventDetailContentSections } from './slots/event-detail-content-sections';
import { EventDetailSignupWarnings } from './slots/event-detail-signup-warnings';
import { BlizzardIntegrationSlot } from './slots/admin-settings-integration-cards';
import { ProfileCharacterActions } from './slots/profile-character-actions';

// Guard against HMR re-execution pushing duplicate registrations
let registered = false;
if (!registered) {
    registered = true;

    registerSlotComponent({
        pluginSlug: 'blizzard',
        slotName: 'character-detail:sections',
        component: CharacterDetailSections,
        priority: 0,
    });

    registerSlotComponent({
        pluginSlug: 'blizzard',
        slotName: 'character-detail:header-badges',
        component: CharacterDetailHeaderBadges,
        priority: 0,
    });

    registerSlotComponent({
        pluginSlug: 'blizzard',
        slotName: 'character-create:import-form',
        component: CharacterCreateImportForm,
        priority: 0,
    });

    registerSlotComponent({
        pluginSlug: 'blizzard',
        slotName: 'character-create:inline-import',
        component: CharacterCreateInlineImport,
        priority: 0,
    });

    registerSlotComponent({
        pluginSlug: 'blizzard',
        slotName: 'event-create:content-browser',
        component: EventCreateContentBrowser,
        priority: 0,
    });

    registerSlotComponent({
        pluginSlug: 'blizzard',
        slotName: 'event-detail:content-sections',
        component: EventDetailContentSections,
        priority: 0,
    });

    registerSlotComponent({
        pluginSlug: 'blizzard',
        slotName: 'event-detail:signup-warnings',
        component: EventDetailSignupWarnings,
        priority: 0,
    });

    registerSlotComponent({
        pluginSlug: 'blizzard',
        slotName: 'admin-settings:integration-cards',
        component: BlizzardIntegrationSlot,
        priority: 0,
    });

    registerSlotComponent({
        pluginSlug: 'blizzard',
        slotName: 'profile:character-actions',
        component: ProfileCharacterActions,
        priority: 0,
    });
}
