import { lazy } from 'react';
import { registerPlugin } from '../plugin-registry';
import { GgWowLevelsCardSchema } from '@raid-ledger/contract';
// App-entry diet: the heavy slots are lazy chunks (see slots/lazy-slots.tsx).
// The character-create import slots and the character header's Sync action stay eager:
// lazy, they shift the Add Character dialog / the phone header's three-action row.
import {
    EventCreateContentBrowser,
    EventDetailContentSections,
    BlizzardIntegrationSlot,
    QuestPrepPanel,
    BossLootPanel,
} from './slots/lazy-slots';
import { CharacterCreateImportForm } from './slots/character-create-import-form';
import { CharacterCreateInlineImport } from './slots/character-create-inline-import';
import { InviteCharacterImport } from './slots/invite-character-import';
import { CharacterDetailSections } from './slots/character-detail-sections';
import { CharacterDetailHeaderBadges } from './slots/character-detail-header-badges';
import { ProfileCharacterActions } from './slots/profile-character-actions';
import { EventDetailSignupWarnings } from './slots/event-detail-signup-warnings';
import { CharacterVariantBadge } from './slots/character-variant-badge';
import { CharacterClassIcon } from './slots/character-class-icon';
import { CharacterProfessions } from './slots/character-professions';
import { CharacterDetailOwnerActions } from './slots/character-detail-owner-actions';
import { CharacterDetailAdminActions } from './slots/character-detail-admin-actions';
import { CharacterDetailReadOnlyActions } from './slots/character-detail-read-only-actions';
import { CharacterCreateHeaderActions } from './slots/character-create-header-actions';
import { PlayersGuildCard } from './slots/players-guild-card';
import { foreverIdentityProvider } from './forever-identity-provider';
import { wowHubModule } from './hub/register-hub';
import { supportsEventReportLinks } from './lib/report-links';
import { useWowEventPlanPrefill } from './hooks/use-event-plan-prefill';
import { registerClassLevelWidgets } from './hub-widgets/class-level.register';
import { registerRolesWidget } from './hub-widgets/roles.register';
import { professionsWidget } from './hub-widgets/professions.register';
import { whosSavedWidget } from './hub-widgets/whos-saved.register';
import { registerDungeonQuestsWidget } from './hub-widgets/dungeon-quests.register';
import { suggestedGroupsWidget } from './hub-widgets/suggested-groups.register';
import { recentDingsWidget } from './hub-widgets/recent-dings.register';
import { lastSeenWidget } from './hub-widgets/last-seen.register';
import { gearReadinessWidget } from './hub-widgets/gear-readiness.register';
import { raidProgressWidget } from './hub-widgets/raid-progress.register';
import { WOW_FOREVER_GAME_SLUG } from './lib/forever-identity';
import { registerReadyCheckWidget } from './hub-widgets/ready-check.register';
import { guildTextWidget } from './hub-widgets/guild-text.register';
import { recruitmentWidget } from './hub-widgets/recruitment.register';
import { contributionsWidget } from './hub-widgets/contributions.register';
import { attunementsWidget } from './hub-widgets/attunements.register';
import { registerClaimBannerWidget } from './hub-widgets/claim-banner.register';
import { wowHubClaimProvider } from './hub/wow-hub-claim-provider';
import { craftersTab } from './hub/crafters/crafters-tab.register';
import { dungeonPlannerTab } from './hub/dungeon-planner/dungeon-planner-tab.register';
import { ADDON_ERRORS_NAV_ITEMS } from './admin/addon-errors-route';
import { wowLfgGrouping } from './lfg/wow-lfg-grouping';

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
blizzard.registerSlot('invite:character-import', InviteCharacterImport);
blizzard.registerSlot('event-create:content-browser', EventCreateContentBrowser);
blizzard.registerSlot('event-detail:content-sections', EventDetailContentSections);
blizzard.registerSlot('event-detail:content-sections', BossLootPanel, 5);
blizzard.registerSlot('event-detail:content-sections', QuestPrepPanel, 10);
blizzard.registerSlot('event-detail:signup-warnings', EventDetailSignupWarnings);
blizzard.registerSlot('admin-settings:plugin-content', BlizzardIntegrationSlot);
blizzard.registerSlot('profile:character-actions', ProfileCharacterActions);
blizzard.registerSlot('character-card:badges', CharacterVariantBadge);
// ROK-2359 — class icons and profession pills on core cards (hidden while blizzard is inactive).
blizzard.registerSlot('character-card:class-icon', CharacterClassIcon);
blizzard.registerSlot('character-card:professions', CharacterProfessions);
blizzard.registerSlot('players:header-cards', PlayersGuildCard);
blizzard.registerCharacterIdentity(foreverIdentityProvider);
blizzard.registerHubModule(wowHubModule);
blizzard.registerEventReportLinks(supportsEventReportLinks);
// ROK-2215 — a dungeon-plan link pre-fills the Create Event form through this provider.
blizzard.registerEventPlanPrefill(useWowEventPlanPrefill);
// ROK-2099 — the Admin → General "Addon errors" row (core shows it only while blizzard is active).
blizzard.registerAdminGeneralNavItems(ADDON_ERRORS_NAV_ITEMS);
// ROK-2352 — one LFG group per dungeon / raid (+ the hub picker), behaviour `wow-instance-lfg`.
blizzard.registerLfgGrouping(wowLfgGrouping);
registerClassLevelWidgets(blizzard);
registerRolesWidget(blizzard);
blizzard.registerHubWidget(professionsWidget);
// ROK-1790 (ruling 2026-11-12 Q1) — the Crafters directory is its own tab on Forever guild hubs.
blizzard.registerHubGameTab([WOW_FOREVER_GAME_SLUG], craftersTab);
// ROK-2216 — the Dungeon planner tab on Forever guild hubs (order 12; `visible` excludes community hubs).
blizzard.registerHubGameTab([WOW_FOREVER_GAME_SLUG], dungeonPlannerTab);
blizzard.registerHubWidget(whosSavedWidget);
registerDungeonQuestsWidget(blizzard);
// ROK-2212 — the Forever "Suggested groups" Overview card (order 43; See all → Dungeon planner tab).
blizzard.registerHubWidget(suggestedGroupsWidget);
registerReadyCheckWidget(blizzard);
blizzard.registerHubWidget(recentDingsWidget);
blizzard.registerHubWidget(lastSeenWidget);
blizzard.registerHubWidget(gearReadinessWidget);
blizzard.registerHubWidget(raidProgressWidget);
blizzard.registerHubWidget(guildTextWidget);
// ROK-1789 — the Forever guild "Recruitment" Overview card (order 14).
blizzard.registerHubWidget(recruitmentWidget);
blizzard.registerHubWidget(contributionsWidget);
// ROK-1927 — the members-only "Attunements" Overview card (order 90).
blizzard.registerHubWidget(attunementsWidget);
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

// ROK-2187 — the WoW "GG <year>" card (levels dinged), declared as blizzard gg-card `wow-levels`.
blizzard.registerGgCard({
    id: 'wow-levels',
    label: 'Levels dinged',
    order: 110,
    schema: GgWowLevelsCardSchema,
    Component: lazy(() => import('./gg/wow-levels-gg-card').then((m) => ({ default: m.GgWowLevelsCardView }))),
});
