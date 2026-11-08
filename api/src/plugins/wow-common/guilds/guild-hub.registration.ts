/**
 * The WoW guild hub's Nest classes, spread into `WowCommonModule` (keeps that
 * module under the 300-line limit, like `blizzard-roster-sync.registration`).
 */
import * as rosterSync from './blizzard-roster-sync.registration';
import { GuildAddonsService } from './guild-addons.service';
import { GuildBlizzardRosterController } from './guild-blizzard-roster.controller';
import { GuildBlizzardRosterService } from './guild-blizzard-roster.service';
import { GuildContentController } from './guild-content.controller';
import { GuildIngameTextController } from './guild-ingame-text.controller';
import { GuildIngameTextService } from './guild-ingame-text.service';
import { GuildPageService } from './guild-page.service';
import { GuildRaidsService } from './guild-raids.service';
import { GuildsController } from './guilds.controller';
import { JoinGateService } from './join-gate/join-gate.service';
import { CharacterOwnerAdminController } from './roster-claim/character-owner.admin.controller';
import { CharacterOwnerAdminService } from './roster-claim/character-owner.admin.service';
import { RosterClaimController } from './roster-claim/roster-claim.controller';
import { RosterClaimService } from './roster-claim/roster-claim.service';

/** Hub page/content/roster routes + ROK-2128 Add character → Guild roster + ROK-2136 in-game text. */
export const CONTROLLERS = [
  GuildsController,
  GuildContentController,
  GuildIngameTextController,
  GuildBlizzardRosterController,
  ...rosterSync.CONTROLLERS,
  RosterClaimController,
  CharacterOwnerAdminController,
];

/** Hub services + the Blizzard roster sync + ROK-2128 roster claim + ROK-2136 in-game text. */
export const PROVIDERS = [
  GuildPageService,
  GuildRaidsService,
  GuildAddonsService,
  GuildIngameTextService,
  GuildBlizzardRosterService,
  ...rosterSync.PROVIDERS,
  RosterClaimService,
  CharacterOwnerAdminService,
  JoinGateService,
];
