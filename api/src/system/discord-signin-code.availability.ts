import type { ModuleRef } from '@nestjs/core';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { SettingsService } from '../settings/settings.service';

/**
 * ROK-2370: the login page offers a Discord sign-in code only when a member
 * can actually confirm one — the bot is online, it sits in a guild, and the
 * instance has a trusted client URL (the `/login` command refuses without
 * it). The bot client is looked up lazily (`strict: false`) so SystemModule
 * does not import DiscordBotModule; a missing provider reads as "off".
 */
export async function isDiscordSigninCodeAvailable(
  moduleRef: ModuleRef,
  settings: SettingsService,
): Promise<boolean> {
  let client: DiscordBotClientService | null = null;
  try {
    client = moduleRef.get(DiscordBotClientService, { strict: false });
  } catch {
    return false;
  }
  if (!client.isConnected() || client.getGuildId() === null) return false;
  const clientUrl = await settings.getTrustedClientUrl();
  return Boolean(clientUrl);
}
