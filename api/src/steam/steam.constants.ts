/**
 * ROK-1835 core Steam link events (not plugin-specific). Emitted with
 * `emitAsync` by `SteamAuthController` AFTER `users.steam_id` changes:
 * linked = after a verified Steam OpenID link, unlinked = after
 * `DELETE /auth/steam/link` (payload carries the SteamID that was removed).
 * Listeners must swallow their own failures — a link never fails because a
 * listener did.
 */
export const STEAM_ACCOUNT_LINKED = 'steam.account-linked';
export const STEAM_ACCOUNT_UNLINKED = 'steam.account-unlinked';

/** Payload of {@link STEAM_ACCOUNT_LINKED} / {@link STEAM_ACCOUNT_UNLINKED}. */
export interface SteamAccountLinkEvent {
  userId: number;
  steamId64: string;
}
