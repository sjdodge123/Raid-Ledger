/** Settings service type definitions and constants. */

export const SETTINGS_EVENTS = {
  OAUTH_DISCORD_UPDATED: 'settings.oauth.discord.updated',
  IGDB_UPDATED: 'settings.igdb.updated',
  BLIZZARD_UPDATED: 'settings.blizzard.updated',
  DEMO_MODE_UPDATED: 'settings.demo_mode.updated',
  DISCORD_BOT_UPDATED: 'settings.discord-bot.updated',
  STEAM_UPDATED: 'settings.steam.updated',
} as const;

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export interface IgdbConfig {
  clientId: string;
  clientSecret: string;
}

export interface BlizzardConfig {
  clientId: string;
  clientSecret: string;
}

export interface BrandingConfig {
  communityName: string | null;
  communityLogoPath: string | null;
  communityAccentColor: string | null;
}

export interface DiscordBotConfig {
  token: string;
  enabled: boolean;
}
