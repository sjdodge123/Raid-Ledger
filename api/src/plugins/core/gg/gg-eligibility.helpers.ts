/**
 * ROK-2187 — who a GG <year> `gg_ready` send reaches, in one place so the
 * admin dry run counts exactly what delivery does: `NotificationService.create`
 * resolves the player's `gg_ready` channel prefs (in-app off ⇒ nothing; Discord
 * off ⇒ in-app only) and only DMs a real Discord id — `local:` / `unlinked:`
 * placeholders never get a DM (Q6: in-app only).
 */
import { resolveChannelPrefs } from '../../../notifications/notification-mapping.helpers';

/** Placeholder `discord_id` prefixes that are not Discord accounts. */
const PLACEHOLDER_DISCORD_PREFIXES = ['local:', 'unlinked:'];

/** Where one player lands in a delivery / dry run. */
export type GgRecipientBucket = 'deactivated' | 'optedOut' | 'noDiscord' | 'dm';

/** The per-user facts the bucket depends on. */
export interface GgRecipientFacts {
  deactivatedAt: Date | null;
  discordId: string | null;
  /** Stored `user_notification_preferences.channel_prefs`, if any. */
  prefs: unknown;
}

/** True for a real Discord account id (not null, not a placeholder). */
export function hasRealDiscordId(discordId: string | null): boolean {
  if (discordId === null || discordId.trim() === '') return false;
  return !PLACEHOLDER_DISCORD_PREFIXES.some((p) => discordId.startsWith(p));
}

/**
 * The bucket for one player: deactivated → skipped; `gg_ready` in-app OR
 * Discord turned off → optedOut (no DM); no real Discord id → noDiscord
 * (in-app only); else a DM.
 */
export function ggRecipientBucket(facts: GgRecipientFacts): GgRecipientBucket {
  if (facts.deactivatedAt !== null) return 'deactivated';
  const ready = resolveChannelPrefs(facts.prefs).gg_ready;
  if (ready.inApp === false || ready.discord === false) return 'optedOut';
  if (!hasRealDiscordId(facts.discordId)) return 'noDiscord';
  return 'dm';
}
