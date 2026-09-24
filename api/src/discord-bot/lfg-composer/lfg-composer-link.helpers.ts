/**
 * ROK-1685 AC1/AC4 — the private replies' `View games ↗` signs the clicker in.
 *
 * Every ephemeral composer reply that shows `View games ↗` links a magic link
 * minted for the Discord user who clicked — never for anyone else, and only
 * in an ephemeral reply (the public pinned card carries no token at all).
 * Each call mints a fresh 15-minute token; nothing is cached, and the link is
 * never logged.
 *
 * Minting comes FIRST and fitting after: the token's length depends on the
 * username inside it, so the `?q=<term>` can only be cut to Discord's 512 cap
 * once the finished token is known (`fitGamesLink`).
 */
import type { MagicLinkService } from '../../auth/magic-link.service';
import type { SettingsService } from '../../settings/settings.service';
import { resolveLfgCaller } from '../commands/lfg.command';
import { fitGamesLink, gamesPageUrl } from './lfg-composer-card.helpers';
import type { Db } from './lfg-composer-search.db-helpers';

/** What minting a composer link needs. */
export interface ComposerLinkDeps {
  db: Db;
  settingsService: Pick<SettingsService, 'getClientUrl'>;
  magicLinkService: Pick<MagicLinkService, 'generateLink'>;
}

/**
 * The `View games ↗` URL for one clicker, searching for `term`.
 *
 * A clicker with no Raid Ledger account, or one who is deactivated or banned,
 * gets the plain /games link and no token is minted. So does a clicker whose
 * minted link cannot fit Discord's cap even without the term.
 *
 * @param deps - Database, settings and the magic-link minter.
 * @param discordUserId - `interaction.user.id` of the clicker, and only that.
 * @param term - What the player searched; blank links plain /games.
 * @returns The link, or null when the deployment has no web URL.
 */
export async function resolveComposerGamesUrl(
  deps: ComposerLinkDeps,
  discordUserId: string,
  term: string,
): Promise<string | null> {
  const clientUrl = await deps.settingsService.getClientUrl();
  const plain = gamesPageUrl(clientUrl, term);
  if (!clientUrl || !plain) return null;
  const caller = await resolveLfgCaller(deps.db, discordUserId);
  if (!caller || caller.deactivatedAt || caller.bannedAt) return plain;
  const link = await deps.magicLinkService.generateLink(
    caller.id,
    '/games',
    clientUrl,
  );
  return (link && fitGamesLink(link, term)) ?? plain;
}
