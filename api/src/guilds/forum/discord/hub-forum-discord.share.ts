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
 * synced posts) and turn on Require tags. A lone hub on a forum that
 * already requires tags still gets one. Returns the joining hub's tag id,
 * or null when an unshared forum needs none.
 */
export async function shareForumTags(
  db: ForumDiscordDb,
  gateway: HubForumDiscordGateway,
  { guildId, forum, info }: ShareInput,
): Promise<string | null> {
  const others = await listForumBindings(db, forum.id);
  const shared = others.length > 0;
  // Codex P2: Require tags outlives the hubs that shared it (and a moderator
  // may have set it), so a lone hub on such a forum still needs its tag.
  if (!shared && !info.requireTag && !forum.requireTagSet) return null;
  const name = (await hubName(db, guildId)) ?? 'Hub';
  const hubs = [...others, { guildId, tagId: null, hubName: name }];
  const plan = planSharedTags(info.tags, hubs);
  if (!info.canManage && (shared || plan.create.length > 0)) {
    throw manageChannelsMissing();
  }
  const mine = await assignTags(db, gateway, guildId, info.id, plan);
  if (!shared) return mine;
  if (others.length === 1)
    await retagLoneHubPosts(db, gateway, info.id, others);
  await gateway.requireTags(info.id);
  if (!forum.requireTagSet)
    await updateForum(db, forum.id, { requireTagSet: true });
  return mine;
}

/** Create the planned tags; tag the other hubs; return the joiner's tag id. */
async function assignTags(
  db: ForumDiscordDb,
  gateway: HubForumDiscordGateway,
  guildId: number,
  channelId: string,
  plan: ReturnType<typeof planSharedTags>,
): Promise<string | null> {
  const tags = await gateway.addTags(channelId, plan.create);
  let mine: string | null = null;
  for (const need of plan.assign) {
    const id = tags.find((t) => t.name === need.name)?.id;
    if (id === undefined) continue;
    if (need.guildId === guildId) mine = id;
    else await tagOtherHub(db, gateway, channelId, need.guildId, id);
  }
  return mine;
}

/**
 * ROK-2258 — a hub tagged while alone on the forum may hold untagged posts
 * (Require tags was off, so Discord users could post bare). As the forum
 * turns shared, its tag lands on every one of its synced posts.
 */
async function retagLoneHubPosts(
  db: ForumDiscordDb,
  gateway: HubForumDiscordGateway,
  channelId: string,
  hubs: readonly { guildId: number; tagId: string | null }[],
): Promise<void> {
  for (const hub of hubs) {
    if (hub.tagId === null) continue;
    const posts = await linkedThreadIds(db, hub.guildId);
    await gateway.applyTag(channelId, posts, hub.tagId);
  }
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
