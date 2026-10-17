/**
 * ROK-1660 — the intro's `My LFGs` answers privately with the presser's list.
 *
 * The intro is one shared message, so this handler only ever replies
 * EPHEMERALLY (`deferReply` → `editReply`) and never `update`s or edits the
 * message the button lives on. The reply is the same list as `/lfg`; its
 * `Leave · {game}` buttons are the existing `lfg:withdraw:<gameId>`, whose
 * listener edits THIS ephemeral list in place — correct here, because nobody
 * else can see it.
 */
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import type { LfgService } from '../../lfg/lfg.service';
import type { SettingsService } from '../../settings/settings.service';
import {
  loadLfgPostLinks,
  loadLfgReplyContext,
  resolveLfgCaller,
} from '../commands/lfg.command';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
  buildListReply,
} from '../commands/lfg.command.helpers';
import type { Db } from './lfg-composer-search.db-helpers';

/** What `My LFGs` reads: the caller, their groups and the reply context. */
export interface ComposerMineDeps {
  db: Db;
  lfgService: Pick<LfgService, 'listGroups'>;
  settingsService: Pick<
    SettingsService,
    'getDiscordBotCommunityName' | 'getClientUrl' | 'getDiscordBotTimezone'
  >;
}

/**
 * Answer one press of the intro's `My LFGs`, privately.
 *
 * @param deps - Database, the LFG service and settings.
 * @param interaction - The `lfgc:mine` press.
 */
export async function showComposerMyLfgs(
  deps: ComposerMineDeps,
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const caller = await resolveLfgCaller(deps.db, interaction.user.id);
  if (!caller) {
    await interaction.editReply(LFG_UNLINKED_REPLY);
    return;
  }
  if (caller.deactivatedAt || caller.bannedAt) {
    await interaction.editReply(LFG_BLOCKED_REPLY);
    return;
  }
  const groups = await deps.lfgService.listGroups(caller.id);
  const own = groups.filter((g) => g.hasOwnIntent);
  const [ctx, postLinks] = await Promise.all([
    loadLfgReplyContext(deps.settingsService),
    loadLfgPostLinks(
      deps.db,
      own.map((g) => g.gameId),
    ),
  ]);
  await interaction.editReply(buildListReply(groups, ctx, postLinks));
}
