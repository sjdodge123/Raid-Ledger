/**
 * ROK-1471 D2 — one board surface per group, chosen at post time.
 *
 * The forum is preferred and text is the fallback, but the choice is made ONCE
 * and then recorded in `lfg_group_messages.post_kind`: a group posted to text
 * stays on text even if the operator flips the toggle mid-life (E4/E5). There
 * is no backfill, so nothing here ever re-homes a live group — this function
 * is only ever asked about a group that has no post yet.
 *
 * Step 0 is the forum. Everything below it is 1454's `resolveLfmChannel`,
 * called unchanged: this story was handed step 0 of that chain and must not
 * reorder the rest.
 *
 * NOTHING here throws. The caller is an `@OnEvent('lfg.lfm_reached')` handler
 * whose emitter is `POST /lfg`, so a database hiccup while reading the board
 * binding must degrade to text — or to "no post" — rather than turning a
 * successful signup into a 500.
 */
import type { ForumChannel, Guild } from 'discord.js';
import type { SettingsCore } from '../../settings/settings-bot.helpers';
import { getLfgBoardEnabled } from '../../settings/settings-lfg-board.helpers';
import {
  resolveLfmChannel,
  type LfmChannelDeps,
} from '../lfm/lfm-channel.helpers';
import type { LfgPostKind } from './lfg-board.constants';

/** 1454's deps plus the two things the forum branch needs. */
export interface LfgBoardSurfaceDeps extends LfmChannelDeps {
  settingsService: LfmChannelDeps['settingsService'] & SettingsCore;
  channelService: { resolveForum(guild: Guild): Promise<ForumChannel | null> };
  guild: Guild | null;
}

/**
 * Where a group's post lives. `guildId` rides along because
 * `lfg_group_messages.guild_id` is NOT NULL and the writer must not have to
 * ask a second source which guild it just resolved against.
 */
export interface LfgBoardSurface {
  kind: LfgPostKind;
  guildId: string;
  channelId: string;
}

/** Best-effort message for a caught `unknown`, never a bare cast. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Step 0: the forum, when the board is enabled and one can be resolved.
 *
 * Swallows its own failures on purpose — a forum that cannot be resolved is
 * not an error, it is the condition the text fallback exists for.
 */
async function resolveForumSurface(
  deps: LfgBoardSurfaceDeps,
  gameId: number,
): Promise<LfgBoardSurface | null> {
  const { guild } = deps;
  if (!guild) return null;
  try {
    if (!(await getLfgBoardEnabled(deps.settingsService))) return null;
    const forum = await deps.channelService.resolveForum(guild);
    if (!forum) return null;
    return { kind: 'forum', guildId: guild.id, channelId: forum.id };
  } catch (err) {
    deps.logger.warn(
      `Could not resolve the LFG forum for game ${String(gameId)}: ` +
        `${describeError(err)}. Falling back to the text board.`,
    );
    return null;
  }
}

/**
 * Choose the surface a group's post should be created on.
 *
 * @param deps - Client, bindings, settings, the forum resolver and the
 *   caller's logger.
 * @param gameId - The `games` PK whose group is being announced.
 * @returns The surface and channel to post in, or null to skip posting.
 *   Exactly one warning is logged on the null path — `resolveLfmChannel`
 *   already explains which binding or default is missing.
 */
export async function resolveLfgBoardSurface(
  deps: LfgBoardSurfaceDeps,
  gameId: number,
): Promise<LfgBoardSurface | null> {
  const forum = await resolveForumSurface(deps, gameId);
  if (forum) return forum;

  try {
    const text = await resolveLfmChannel(deps, gameId);
    if (!text) return null;
    return { kind: 'text', guildId: text.guildId, channelId: text.channelId };
  } catch (err) {
    deps.logger.warn(
      `Could not resolve any channel for LFG game ${String(gameId)}: ` +
        `${describeError(err)}. Skipping the post.`,
    );
    return null;
  }
}
