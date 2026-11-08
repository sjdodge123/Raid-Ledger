/**
 * ROK-1786 / ROK-2136 — the guild content Nest classes (GM post, rules, links,
 * addons; the in-game MOTD + Guild Information), spread into
 * `WowCommonModule` (keeps that module under the 300-line limit).
 */
import { GuildAddonsService } from './guild-addons.service';
import { GuildContentController } from './guild-content.controller';
import { GuildIngameTextController } from './guild-ingame-text.controller';
import { GuildIngameTextService } from './guild-ingame-text.service';

export const PROVIDERS = [GuildAddonsService, GuildIngameTextService];

/** `/plugins/wow/guilds/:id/{profile,addons,ingame-text}`. */
export const CONTROLLERS = [GuildContentController, GuildIngameTextController];
