/**
 * Helper functions for settings service integration reconnection.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SETTING_KEYS } from '../drizzle/schema';
import { SETTINGS_EVENTS } from './settings.types';

/** Emit reconnect events for Discord bot if configured. */
export function emitBotReconnect(
  cache: Map<string, string>,
  emitter: EventEmitter2,
): void {
  const botToken = cache.get(SETTING_KEYS.DISCORD_BOT_TOKEN);
  const botEnabled = cache.get(SETTING_KEYS.DISCORD_BOT_ENABLED);
  if (botToken && botEnabled === 'true') {
    emitter.emit(SETTINGS_EVENTS.DISCORD_BOT_UPDATED, {
      token: botToken,
      enabled: true,
    });
  }
}

/** Emit reconnect events for Discord OAuth if configured. */
export function emitOAuthReconnect(
  cache: Map<string, string>,
  emitter: EventEmitter2,
): void {
  const id = cache.get(SETTING_KEYS.DISCORD_CLIENT_ID);
  const secret = cache.get(SETTING_KEYS.DISCORD_CLIENT_SECRET);
  const callback = cache.get(SETTING_KEYS.DISCORD_CALLBACK_URL);
  if (id && secret && callback) {
    emitter.emit(SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED, {
      clientId: id,
      clientSecret: secret,
      callbackUrl: callback,
    });
  }
}

/** Emit reconnect events for IGDB if configured. */
export function emitIgdbReconnect(
  cache: Map<string, string>,
  emitter: EventEmitter2,
): void {
  const id = cache.get(SETTING_KEYS.IGDB_CLIENT_ID);
  const secret = cache.get(SETTING_KEYS.IGDB_CLIENT_SECRET);
  if (id && secret) {
    emitter.emit(SETTINGS_EVENTS.IGDB_UPDATED, {
      clientId: id,
      clientSecret: secret,
    });
  }
}

/** Emit reconnect events for Blizzard if configured. */
export function emitBlizzardReconnect(
  cache: Map<string, string>,
  emitter: EventEmitter2,
): void {
  const id = cache.get(SETTING_KEYS.BLIZZARD_CLIENT_ID);
  const secret = cache.get(SETTING_KEYS.BLIZZARD_CLIENT_SECRET);
  if (id && secret) {
    emitter.emit(SETTINGS_EVENTS.BLIZZARD_UPDATED, {
      clientId: id,
      clientSecret: secret,
    });
  }
}
