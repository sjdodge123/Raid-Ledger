/**
 * Settings helper functions delegated from SettingsService.
 */
import { SETTING_KEYS, SettingKey } from '../drizzle/schema';
import type {
  DiscordOAuthConfig,
  IgdbConfig,
  BlizzardConfig,
  BrandingConfig,
  DiscordBotConfig,
} from './settings.types';

/** Thin wrapper around SettingsService core methods. */
export interface SettingsCore {
  get(key: SettingKey): Promise<string | null>;
  set(key: SettingKey, value: string): Promise<void>;
  exists(key: SettingKey): Promise<boolean>;
  delete(key: SettingKey): Promise<void>;
}

/** Get Discord OAuth configuration. */
export async function getDiscordOAuthConfig(
  svc: SettingsCore,
): Promise<DiscordOAuthConfig | null> {
  const [clientId, clientSecret, callbackUrl] = await Promise.all([
    svc.get(SETTING_KEYS.DISCORD_CLIENT_ID),
    svc.get(SETTING_KEYS.DISCORD_CLIENT_SECRET),
    svc.get(SETTING_KEYS.DISCORD_CALLBACK_URL),
  ]);
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    callbackUrl: callbackUrl || 'http://localhost:3000/auth/discord/callback',
  };
}

/** Get IGDB configuration. */
export async function getIgdbConfig(
  svc: SettingsCore,
): Promise<IgdbConfig | null> {
  const [clientId, clientSecret] = await Promise.all([
    svc.get(SETTING_KEYS.IGDB_CLIENT_ID),
    svc.get(SETTING_KEYS.IGDB_CLIENT_SECRET),
  ]);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Get Blizzard API configuration. */
export async function getBlizzardConfig(
  svc: SettingsCore,
): Promise<BlizzardConfig | null> {
  const [clientId, clientSecret] = await Promise.all([
    svc.get(SETTING_KEYS.BLIZZARD_CLIENT_ID),
    svc.get(SETTING_KEYS.BLIZZARD_CLIENT_SECRET),
  ]);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Check if a pair of settings keys are both configured. */
export async function bothExist(
  svc: SettingsCore,
  keyA: SettingKey,
  keyB: SettingKey,
): Promise<boolean> {
  const [a, b] = await Promise.all([svc.exists(keyA), svc.exists(keyB)]);
  return a && b;
}

/** Get community branding settings. */
export async function getBranding(svc: SettingsCore): Promise<BrandingConfig> {
  const [name, logo, color] = await Promise.all([
    svc.get(SETTING_KEYS.COMMUNITY_NAME),
    svc.get(SETTING_KEYS.COMMUNITY_LOGO_PATH),
    svc.get(SETTING_KEYS.COMMUNITY_ACCENT_COLOR),
  ]);
  return {
    communityName: name,
    communityLogoPath: logo,
    communityAccentColor: color,
  };
}

/** Clear all branding settings. */
export async function clearBranding(svc: SettingsCore): Promise<void> {
  await Promise.all([
    svc.delete(SETTING_KEYS.COMMUNITY_NAME),
    svc.delete(SETTING_KEYS.COMMUNITY_LOGO_PATH),
    svc.delete(SETTING_KEYS.COMMUNITY_ACCENT_COLOR),
  ]);
}

/** Set Discord OAuth configuration keys. */
export async function setDiscordOAuthKeys(
  svc: SettingsCore,
  config: DiscordOAuthConfig,
): Promise<void> {
  await Promise.all([
    svc.set(SETTING_KEYS.DISCORD_CLIENT_ID, config.clientId),
    svc.set(SETTING_KEYS.DISCORD_CLIENT_SECRET, config.clientSecret),
    svc.set(SETTING_KEYS.DISCORD_CALLBACK_URL, config.callbackUrl),
  ]);
}

/** Set IGDB configuration keys. */
export async function setIgdbKeys(
  svc: SettingsCore,
  config: IgdbConfig,
): Promise<void> {
  await Promise.all([
    svc.set(SETTING_KEYS.IGDB_CLIENT_ID, config.clientId),
    svc.set(SETTING_KEYS.IGDB_CLIENT_SECRET, config.clientSecret),
  ]);
}

/** Set Blizzard configuration keys. */
export async function setBlizzardKeys(
  svc: SettingsCore,
  config: BlizzardConfig,
): Promise<void> {
  await Promise.all([
    svc.set(SETTING_KEYS.BLIZZARD_CLIENT_ID, config.clientId),
    svc.set(SETTING_KEYS.BLIZZARD_CLIENT_SECRET, config.clientSecret),
  ]);
}

/** Get Discord bot configuration. */
export async function getDiscordBotConfig(
  svc: SettingsCore,
): Promise<DiscordBotConfig | null> {
  const token = await svc.get(SETTING_KEYS.DISCORD_BOT_TOKEN);
  if (!token) return null;
  const enabled = await svc.get(SETTING_KEYS.DISCORD_BOT_ENABLED);
  return { token, enabled: enabled === 'true' };
}

/** Get client URL with fallback chain. */
export async function getClientUrl(svc: SettingsCore): Promise<string | null> {
  const explicit = await svc.get(SETTING_KEYS.CLIENT_URL);
  if (explicit) return explicit;
  if (process.env.CLIENT_URL) return process.env.CLIENT_URL;
  const callbackUrl = await svc.get(SETTING_KEYS.DISCORD_CALLBACK_URL);
  if (callbackUrl) {
    try {
      return new URL(callbackUrl).origin;
    } catch {
      /* invalid URL */
    }
  }
  return null;
}

/** Set Discord bot token and enabled keys. */
export async function setDiscordBotKeys(
  svc: SettingsCore,
  token: string,
  enabled: boolean,
): Promise<void> {
  await Promise.all([
    svc.set(SETTING_KEYS.DISCORD_BOT_TOKEN, token),
    svc.set(SETTING_KEYS.DISCORD_BOT_ENABLED, enabled ? 'true' : 'false'),
  ]);
}

/** Clear Discord bot keys. */
export async function clearDiscordBotKeys(svc: SettingsCore): Promise<void> {
  await Promise.all([
    svc.delete(SETTING_KEYS.DISCORD_BOT_TOKEN),
    svc.delete(SETTING_KEYS.DISCORD_BOT_ENABLED),
  ]);
}

/** Parse an integer setting with a default fallback. */
async function getIntSetting(
  svc: SettingsCore,
  key: SettingKey,
  defaultVal: number,
): Promise<number> {
  const v = await svc.get(key);
  const n = v ? parseInt(v, 10) : NaN;
  return isNaN(n) ? defaultVal : n;
}

/** Get auto-extend increment minutes (default 15). */
export async function getAutoExtendIncrement(
  svc: SettingsCore,
): Promise<number> {
  return getIntSetting(
    svc,
    SETTING_KEYS.EVENT_AUTO_EXTEND_INCREMENT_MINUTES,
    15,
  );
}

/** Get auto-extend max overage minutes (default 720). */
export async function getAutoExtendMaxOverage(
  svc: SettingsCore,
): Promise<number> {
  return getIntSetting(
    svc,
    SETTING_KEYS.EVENT_AUTO_EXTEND_MAX_OVERAGE_MINUTES,
    720,
  );
}

/** Get auto-extend min voice members (default 2). */
export async function getAutoExtendMinVoice(
  svc: SettingsCore,
): Promise<number> {
  return getIntSetting(
    svc,
    SETTING_KEYS.EVENT_AUTO_EXTEND_MIN_VOICE_MEMBERS,
    2,
  );
}
