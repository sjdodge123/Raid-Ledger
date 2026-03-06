import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';

/**
 * Rate-limit tracker for signup button interactions.
 * Prevents spam clicks within a cooldown window.
 */
const interactionCooldowns = new Map<string, number>();

/** Cooldown window (ms) between interactions per user per event. */
export const COOLDOWN_MS = 3000;

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = 0;

/** Remove expired entries from the cooldown map. */
export function cleanupCooldowns(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, timestamp] of interactionCooldowns) {
    if (now - timestamp >= COOLDOWN_MS) {
      interactionCooldowns.delete(key);
    }
  }
}

/** Get the last interaction timestamp for a key. */
export function getCooldown(key: string): number | undefined {
  return interactionCooldowns.get(key);
}

/** Set the last interaction timestamp for a key. */
export function setCooldown(key: string, ts: number): void {
  interactionCooldowns.set(key, ts);
}

/**
 * Check if an error is a Discord API interaction race condition.
 * Code 40060 = already acknowledged, 10062 = expired token.
 */
export function isDiscordInteractionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code: number }).code === 40060 ||
      (error as { code: number }).code === 10062)
  );
}

/** Logger shape for safe reply helpers. */
interface MinimalLogger {
  warn: (msg: string) => void;
}

/**
 * Safely reply to an interaction, catching Discord API errors.
 */
export async function safeReply(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  options: { content: string; ephemeral?: boolean },
  logger: MinimalLogger,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: options.content });
    } else {
      await interaction.reply(options);
    }
  } catch (error: unknown) {
    if (isDiscordInteractionError(error)) {
      logger.warn(
        `Interaction response failed (code ${(error as { code: number }).code}): ${(error as Error).message}`,
      );
      return;
    }
    throw error;
  }
}

/**
 * Safely edit a deferred/replied interaction.
 */
export async function safeEditReply(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  options: Parameters<ButtonInteraction['editReply']>[0],
  logger: MinimalLogger,
): Promise<void> {
  try {
    await interaction.editReply(options);
  } catch (error: unknown) {
    if (isDiscordInteractionError(error)) {
      logger.warn(
        `Interaction editReply failed (code ${(error as { code: number }).code}): ${(error as Error).message}`,
      );
      return;
    }
    throw error;
  }
}
