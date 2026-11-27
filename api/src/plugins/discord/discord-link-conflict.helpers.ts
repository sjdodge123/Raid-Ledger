/**
 * Profile "Link Discord": refuse a snowflake that already belongs to another
 * user. ROK-2371 AC7 / spec §3: when the signed-in account has Google sign-in
 * (a Google-created account), the refusal tells them how to get both methods
 * on one account instead. The message rides `?linked=error&message=`.
 */
import type { UsersService } from '../../users/users.service';

export const DISCORD_LINK_TAKEN_MESSAGE =
  'This Discord account is already linked to another user';

export const DISCORD_LINK_TAKEN_GOOGLE_ACCOUNT_MESSAGE =
  "That Discord account already has its own Raid Ledger account. Sign out, sign in with Discord, and link Google from that account's Profile instead.";

/** The Google sign-in seam; absent when that module is not wired. */
export interface GoogleIdentityLookup {
  hasGoogleIdentity(userId: number): Promise<boolean>;
}

/** Throw when `discordId` (incl. an `unlinked:` row) is on another user. */
export async function assertDiscordNotOnAnotherUser(
  usersService: Pick<UsersService, 'findByDiscordIdIncludingUnlinked'>,
  google: GoogleIdentityLookup | undefined,
  ids: { discordId: string; userId: number },
): Promise<void> {
  const owner = await usersService.findByDiscordIdIncludingUnlinked(
    ids.discordId,
  );
  if (!owner || owner.id === ids.userId) return;
  const hasGoogle = google ? await google.hasGoogleIdentity(ids.userId) : false;
  throw new Error(
    hasGoogle
      ? DISCORD_LINK_TAKEN_GOOGLE_ACCOUNT_MESSAGE
      : DISCORD_LINK_TAKEN_MESSAGE,
  );
}
