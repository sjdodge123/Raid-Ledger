import { registerPlugin } from '../plugin-registry';
import { CharacterDetailSections } from './slots/character-detail-sections';
import { CharacterDetailHeaderBadges } from './slots/character-detail-header-badges';
import { CharacterCreateImportForm } from './slots/character-create-import-form';
import { CharacterCreateInlineImport } from './slots/character-create-inline-import';
import { EventCreateContentBrowser } from './slots/event-create-content-browser';
import { EventDetailContentSections } from './slots/event-detail-content-sections';
import { EventDetailSignupWarnings } from './slots/event-detail-signup-warnings';
import { BlizzardIntegrationSlot } from './slots/admin-settings-integration-cards';
import { ProfileCharacterActions } from './slots/profile-character-actions';
import { QuestPrepPanel } from './slots/quest-prep-panel';
import { BossLootPanel } from './slots/boss-loot-panel';

// Guard against HMR re-execution pushing duplicate registrations
let registered = false;
if (!registered) {
    registered = true;

    const blizzard = registerPlugin('blizzard', {
        icon: '/plugins/blizzard/badge.jpg',
        iconSmall: '/plugins/blizzard/badge-32.jpg',
        color: 'blue',
        label: 'World of Warcraft Plugin',
    });

    blizzard.registerSlot('character-detail:sections', CharacterDetailSections);
    blizzard.registerSlot('character-detail:header-badges', CharacterDetailHeaderBadges);
    blizzard.registerSlot('character-create:import-form', CharacterCreateImportForm);
    blizzard.registerSlot('character-create:inline-import', CharacterCreateInlineImport);
    blizzard.registerSlot('event-create:content-browser', EventCreateContentBrowser);
    blizzard.registerSlot('event-detail:content-sections', EventDetailContentSections);
    blizzard.registerSlot('event-detail:content-sections', BossLootPanel, 5);
    blizzard.registerSlot('event-detail:content-sections', QuestPrepPanel, 10);
    blizzard.registerSlot('event-detail:signup-warnings', EventDetailSignupWarnings);
    blizzard.registerSlot('admin-settings:plugin-content', BlizzardIntegrationSlot);
    blizzard.registerSlot('profile:character-actions', ProfileCharacterActions);
}
