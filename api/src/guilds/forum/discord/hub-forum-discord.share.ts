import type { HubForumDiscordForumSelect } from '../../../drizzle/schema';
import type {
  ForumInfo,
  HubForumDiscordGateway,
} from './hub-forum-discord.gateway';
import { forumDiscordError, planSharedTags } from './hub-forum-discord.helpers';
import {
  hubName,
  linkedThreadIds,
  listForumBindings,
  setBindingTag,
  updateForum,
  type ForumDiscordDb,
} from './hub-forum-discord.queries';

/** The hub joining a forum, the forum row and its live Discord view. */
export interface ShareInput {
  guildId: number;
  forum: HubForumDiscordForumSelect;
  info: ForumInfo;
}

/**
 * ROK-2208 §5.1 step 6 / D6 — when a hub joins a forum another hub already
 * uses, give every sharing hub a tag (the first hub's tag also lands on its
 * synced posts) and turn on Require tags. Returns the joining hub's tag id,
 * or null on an unshared forum.
 */
export async function shareForumTags(
  db: ForumDiscordDb,
  gateway: HubForumDiscordGateway,
  { guildId, forum, info }: ShareInput,
): Promise<string | null> {
  const others = await listForumBindings(db, forum.id);
  if (others.length === 0) return null;
  const name = (await hubName(db, guildId)) ?? 'Hub';
  const hubs = [...others, { guildId, tagId: null, hubName: name }];
  const plan = planSharedTags(info.tags, hubs);
  if (!info.canManage) throw manageChannelsMissing();
  const tags = await gateway.addTags(info.id, plan.create);
  let mine: string | null = null;
  for (const need of plan.assign) {
    const id = tags.find((t) => t.name === need.name)?.id;
    if (id === undefined) continue;
    if (need.guildId === guildId) mine = id;
    else await tagOtherHub(db, gateway, info.id, need.guildId, id);
  }
  await gateway.requireTags(info.id);
  if (!forum.requireTagSet)
    await updateForum(db, forum.id, { requireTagSet: true });
  return mine;
}

/** Tag edits ride on Manage Channels (422 with that one label). */
function manageChannelsMissing() {
  return forumDiscordError(
    422,
    'FORUM_DISCORD_MISSING_PERMS',
    'The bot is missing: Manage Channels.',
    { missing: ['Manage Channels'] },
  );
}

/** Give an already-bound hub its tag and put it on that hub's synced posts. */
async function tagOtherHub(
  db: ForumDiscordDb,
  gateway: HubForumDiscordGateway,
  channelId: string,
  guildId: number,
  tagId: string,
): Promise<void> {
  await setBindingTag(db, guildId, tagId);
  await gateway.applyTag(channelId, await linkedThreadIds(db, guildId), tagId);
}
