/**
 * The WoW guild hub's Nest classes, spread into `WowCommonModule` (keeps that
 * module under the 300-line limit, like `blizzard-roster-sync.registration`).
 */
import * as rosterSync from './blizzard-roster-sync.registration';
import { GuildAddonsService } from './guild-addons.service';
import { GuildBlizzardRosterController } from './guild-blizzard-roster.controller';
import { GuildBlizzardRosterService } from './guild-blizzard-roster.service';
import { GuildContentController } from './guild-content.controller';
import { GuildPageService } from './guild-page.service';
import { GuildRaidsService } from './guild-raids.service';
import { GuildsController } from './guilds.controller';
import { RosterClaimController } from './roster-claim/roster-claim.controller';
import { RosterClaimService } from './roster-claim/roster-claim.service';

/** Hub page/content/roster routes + ROK-2128 Add character → Guild roster. */
export const CONTROLLERS = [
  GuildsController,
  GuildContentController,
  GuildBlizzardRosterController,
  ...rosterSync.CONTROLLERS,
  RosterClaimController,
];

/** Hub services + the Blizzard roster sync + ROK-2128 roster claim. */
export const PROVIDERS = [
  GuildPageService,
  GuildRaidsService,
  GuildAddonsService,
  GuildBlizzardRosterService,
  ...rosterSync.PROVIDERS,
  RosterClaimService,
];
