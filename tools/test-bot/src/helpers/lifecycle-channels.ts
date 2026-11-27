/**
 * ROK-1428 (L10) — Discord-side helpers for the channel-lifecycle smoke: read
 * a guild channel fresh from Discord (never the gateway cache), check the
 * archive lock, sweep `smoke-lc-*` leftovers and best-effort delete. The
 * companion bot needs Manage Channels for the sweep / delete — callers check
 * {@link companionCanManageChannels} before creating anything.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type GuildBasedChannel,
  type TextChannel,
} from "discord.js";
import { getGuild } from "../client.js";

/** Every channel / category the lifecycle smoke creates starts with this. */
export const LIFECYCLE_SMOKE_PREFIX = "smoke-lc-";

/** True when the companion bot may create and delete channels. */
export async function companionCanManageChannels(): Promise<boolean> {
  const me = await getGuild().members.fetchMe();
  return me.permissions.has(PermissionFlagsBits.ManageChannels);
}

/** Create a category the smoke owns (deleted again in teardown). */
export async function createSmokeCategory(name: string): Promise<CategoryChannel> {
  return getGuild().channels.create({
    name,
    type: ChannelType.GuildCategory,
    reason: "ROK-1428 lifecycle smoke",
  });
}

/** A fresh read of one channel; null when Discord says it is gone. */
export async function fetchChannelFresh(id: string): Promise<GuildBasedChannel | null> {
  return getGuild()
    .channels.fetch(id, { force: true })
    .catch(() => null);
}

/** The guild's text channel named `name`, fresh from Discord; null if absent. */
export async function findTextChannelByName(name: string): Promise<TextChannel | null> {
  const all = await getGuild().channels.fetch();
  const hit = all.find((c) => c?.type === ChannelType.GuildText && c.name === name);
  return hit?.type === ChannelType.GuildText ? hit : null;
}

/** Whether `@everyone` is denied SendMessages on the channel. */
export function everyoneSendDenied(channel: TextChannel): boolean {
  const overwrite = channel.permissionOverwrites.cache.get(channel.guild.id);
  return overwrite?.deny.has(PermissionFlagsBits.SendMessages) ?? false;
}

/** Best-effort delete; a failure is logged, never thrown (teardown must not mask). */
export async function deleteChannelQuietly(id: string): Promise<void> {
  const channel = await fetchChannelFresh(id);
  if (!channel) return;
  await channel.delete("ROK-1428 lifecycle smoke cleanup").catch((err: unknown) => {
    console.warn(`  lifecycle smoke: delete ${id} failed: ${String(err)}`);
  });
}

/**
 * A `smoke-lc-*` channel younger than this may belong to a run on the OTHER
 * lease slot (the shared guild runs two discord-smoke jobs at once), so the
 * sweep leaves it alone. The lifecycle test holds its channels for ~1 min; a
 * crashed run's leftovers are swept by the first run after they age out.
 */
export const LIFECYCLE_SWEEP_MIN_AGE_MS = 15 * 60_000;

/** True when a channel is a lifecycle-smoke leftover old enough to delete. */
export function isSweepableLifecycleLeftover(
  name: string,
  createdTimestamp: number,
  now: number,
): boolean {
  return name.startsWith(LIFECYCLE_SMOKE_PREFIX) && now - createdTimestamp >= LIFECYCLE_SWEEP_MIN_AGE_MS;
}

/** Delete the `smoke-lc-*` channels and categories left by an earlier run. */
export async function sweepLifecycleLeftovers(now: number = Date.now()): Promise<number> {
  const all = await getGuild().channels.fetch();
  const stale = [...all.values()].filter(
    (c): c is NonNullable<typeof c> =>
      c !== null && isSweepableLifecycleLeftover(c.name, c.createdTimestamp, now),
  );
  // Children first, so a category is empty when it goes.
  stale.sort((a, b) => Number(a.type === ChannelType.GuildCategory) - Number(b.type === ChannelType.GuildCategory));
  for (const c of stale) await deleteChannelQuietly(c.id);
  return stale.length;
}
