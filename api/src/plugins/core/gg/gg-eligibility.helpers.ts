/**
 * ROK-2187 — who a GG <year> `gg_ready` send reaches, in one place so the
 * admin dry run counts exactly what delivery does: `NotificationService.create`
 * resolves the player's `gg_ready` channel prefs (bell AND Discord off ⇒
 * nothing; Discord off ⇒ in-app only; ROK-2290: bell off + Discord on ⇒ a
 * hidden row and the DM) and only DMs a real Discord id — `local:` /
 * `unlinked:` placeholders never get a DM (Q6: in-app only).
 */
import { resolveStoredDelivery } from '../../../notifications/notification-create.helpers';
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
 * The bucket for one player: deactivated → skipped; `gg_ready` bell AND
 * Discord off → optedOut (nothing is delivered); Discord off for `gg_ready` OR
 * no real Discord id → noDiscord (no DM; the in-app notification when the bell
 * is on); else a DM — including bell off + Discord on (ROK-2290).
 */
export function ggRecipientBucket(facts: GgRecipientFacts): GgRecipientBucket {
  if (facts.deactivatedAt !== null) return 'deactivated';
  if (resolveStoredDelivery('gg_ready', facts.prefs) === 'none') {
    return 'optedOut';
  }
  if (resolveChannelPrefs(facts.prefs).gg_ready.discord === false) {
    return 'noDiscord';
  }
  if (!hasRealDiscordId(facts.discordId)) return 'noDiscord';
  return 'dm';
}
