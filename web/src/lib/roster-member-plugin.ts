/**
 * ROK-2360 — hub roster members (`/hubs/:id/members/:memberId`) are served by
 * the WoW plugin's api (`/plugins/wow/guilds/:id/members/:memberId`), so the
 * page and its query only run while this plugin is active.
 */
export const ROSTER_MEMBER_PLUGIN = 'blizzard';
