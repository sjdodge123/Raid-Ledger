export const DISCORD_BOT_EVENTS = {
  CONNECTED: 'discord-bot.connected',
  DISCONNECTED: 'discord-bot.disconnected',
  ERROR: 'discord-bot.error',
} as const;

/**
 * Convert Discord.js errors into admin-friendly messages.
 * Shared between DiscordBotService and DiscordBotClientService to avoid
 * duplicating intent / token / network error detection.
 */
export function friendlyDiscordErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Failed to connect with provided token';
  const raw = error.message;

  if (
    /disallowed intent|privileged intent/i.test(raw) ||
    (error as Error & { code?: number })?.code === 4014
  ) {
    return 'Missing required privileged intent: Server Members. Enable it in the Discord Developer Portal under Bot > Privileged Gateway Intents.';
  }
  if (/invalid token|TOKEN_INVALID/i.test(raw)) {
    return 'Invalid bot token. Please check the token and try again.';
  }
  if (/getaddrinfo|ENOTFOUND/i.test(raw)) {
    return 'Unable to reach Discord servers. Check your internet connection.';
  }
  if (/ECONNREFUSED/i.test(raw)) {
    return 'Connection to Discord was refused. Try again in a few moments.';
  }

  return 'Failed to connect with provided token';
}
