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
import { CharacterVariantBadge } from './slots/character-variant-badge';
import { CharacterDetailOwnerActions } from './slots/character-detail-owner-actions';
import { CharacterDetailAdminActions } from './slots/character-detail-admin-actions';
import { CharacterDetailReadOnlyActions } from './slots/character-detail-read-only-actions';
import { CharacterCreateHeaderActions } from './slots/character-create-header-actions';
import { PlayersGuildCard } from './slots/players-guild-card';
import { foreverIdentityProvider } from './forever-identity-provider';
import { wowHubModule } from './hub/register-hub';
import { supportsEventReportLinks } from './lib/report-links';
import { registerClassLevelWidgets } from './hub-widgets/class-level.register';
import { registerRolesWidget } from './hub-widgets/roles.register';
import { professionsWidget } from './hub-widgets/professions.register';
import { whosSavedWidget } from './hub-widgets/whos-saved.register';
import { registerDungeonQuestsWidget } from './hub-widgets/dungeon-quests.register';
import { recentDingsWidget } from './hub-widgets/recent-dings.register';
import { lastSeenWidget } from './hub-widgets/last-seen.register';
import { gearReadinessWidget } from './hub-widgets/gear-readiness.register';
import { raidProgressWidget } from './hub-widgets/raid-progress.register';
import { WOW_FOREVER_GAME_SLUG } from './lib/forever-identity';
import { registerReadyCheckWidget } from './hub-widgets/ready-check.register';
import { guildTextWidget } from './hub-widgets/guild-text.register';
import { contributionsWidget } from './hub-widgets/contributions.register';
import { registerClaimBannerWidget } from './hub-widgets/claim-banner.register';
import { wowHubClaimProvider } from './hub/wow-hub-claim-provider';

const blizzard = registerPlugin('blizzard', {
    icon: '/plugins/blizzard/badge.jpg',
    iconSmall: '/plugins/blizzard/badge-32.jpg',
    color: 'blue',
    label: 'World of Warcraft Plugin',
});

blizzard.registerSlot('character-detail:sections', CharacterDetailSections);
blizzard.registerSlot('character-detail:header-badges', CharacterDetailHeaderBadges);
blizzard.registerSlot('character-detail:owner-actions', CharacterDetailOwnerActions);
blizzard.registerSlot('character-detail:admin-actions', CharacterDetailAdminActions);
blizzard.registerSlot('character-detail:read-only-actions', CharacterDetailReadOnlyActions);
blizzard.registerSlot('character-create:header-actions', CharacterCreateHeaderActions);
blizzard.registerSlot('character-create:import-form', CharacterCreateImportForm);
blizzard.registerSlot('character-create:inline-import', CharacterCreateInlineImport);
blizzard.registerSlot('event-create:content-browser', EventCreateContentBrowser);
blizzard.registerSlot('event-detail:content-sections', EventDetailContentSections);
blizzard.registerSlot('event-detail:content-sections', BossLootPanel, 5);
blizzard.registerSlot('event-detail:content-sections', QuestPrepPanel, 10);
blizzard.registerSlot('event-detail:signup-warnings', EventDetailSignupWarnings);
blizzard.registerSlot('admin-settings:plugin-content', BlizzardIntegrationSlot);
blizzard.registerSlot('profile:character-actions', ProfileCharacterActions);
blizzard.registerSlot('character-card:badges', CharacterVariantBadge);
blizzard.registerSlot('players:header-cards', PlayersGuildCard);
blizzard.registerCharacterIdentity(foreverIdentityProvider);
blizzard.registerHubModule(wowHubModule);
blizzard.registerEventReportLinks(supportsEventReportLinks);
registerClassLevelWidgets(blizzard);
registerRolesWidget(blizzard);
blizzard.registerHubWidget(professionsWidget);
blizzard.registerHubWidget(whosSavedWidget);
registerDungeonQuestsWidget(blizzard);
registerReadyCheckWidget(blizzard);
blizzard.registerHubWidget(recentDingsWidget);
blizzard.registerHubWidget(lastSeenWidget);
blizzard.registerHubWidget(gearReadinessWidget);
blizzard.registerHubWidget(raidProgressWidget);
blizzard.registerHubWidget(guildTextWidget);
blizzard.registerHubWidget(contributionsWidget);
// ROK-2151 — the staff non-member "Claim your character" banner atop a claimable Forever guild's Overview.
registerClaimBannerWidget(blizzard);

// ROK-2153 S5 — the web half of the api `blizzard` hub claim provider (Forever guild
// hubs). `overviewPrompt: false`: membership IS a claimed roster row, so the Overview
// never mounts the core prompt on a WoW hub; the staff banner above and the join gate
// keep the claim action.
blizzard.registerHubClaimProvider(wowHubClaimProvider);

// ROK-2056 L4 — the hub Overview's "install the Companion" card on Forever guild
// hubs (the same game scope as every Forever widget). Requirement
// `ledgerlink-companion` in BLIZZARD_SETUP carries `rlCompanion: wow-ledgerlink`.
blizzard.registerHubCompanionPrompt({
    requirementId: 'ledgerlink-companion',
    games: [WOW_FOREVER_GAME_SLUG],
    kinds: ['wow_guild'],
    heading: 'Upload your LedgerLink exports automatically',
    body: 'This hub reads LedgerLink exports. Install the Raid Ledger Companion on the PC you play WoW on and your exports upload when you log out, or keep pasting them.',
    shortBody: 'Install the Raid Ledger Companion on the PC you play WoW on, or keep pasting exports.',
});
