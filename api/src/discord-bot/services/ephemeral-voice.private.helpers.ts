import { PermissionFlagsBits, type OverwriteResolvable } from 'discord.js';

/**
 * Pure helpers for private (roster-only) ephemeral voice channels (ROK-1386).
 *
 * Kept infrastructure-free so the allow-list rules and overwrite shape are
 * unit-testable without a live Discord guild. The discord-side apply lives in
 * `ephemeral-voice.discord-ops.ts`; persistence lives in the db-helpers.
 */

/** A signup row reduced to the fields the allow-list cares about. */
export interface RosterSignupRow {
  /** Roster slot the player was allocated to. `bench` excludes them. */
  assignedSlot: string | null;
  /** Attendance intent. Only `signed_up` / `tentative` are allow-listed. */
  status: string;
  /** Linked-member Discord id (users.discordId). Preferred. */
  userDiscordId: string | null;
  /** Anonymous-participant Discord id (signup.discordUserId). Fallback. */
  signupDiscordUserId: string | null;
}

/**
 * Resolve the rostered-only allow-list of Discord ids from signup rows.
 *
 * Rules: exclude benched players; include only `signed_up` / `tentative`
 * (tentative included only when not benched); resolve `users.discordId` then
 * `signup.discordUserId`; drop rows whose resolved id is null (unlinked members
 * are silently blocked).
 */
export function computeAllowedDiscordIds(
  rows: RosterSignupRow[],
): Set<string> {
  const allowed = new Set<string>();
  for (const row of rows) {
    if (row.assignedSlot === 'bench') continue;
    if (row.status !== 'signed_up' && row.status !== 'tentative') continue;
    const id = row.userDiscordId ?? row.signupDiscordUserId;
    if (id) allowed.add(id);
  }
  return allowed;
}

/**
 * Build the permission-overwrite list for a private channel: deny Connect for
 * `@everyone` (id = guildId) while keeping it visible (ViewChannel allowed), an
 * explicit allow for the bot so the deny can't lock it out, and Connect +
 * ViewChannel for each allow-listed member.
 */
export function buildPrivateVoiceOverwrites(opts: {
  guildId: string;
  botId: string;
  allowedDiscordIds: Iterable<string>;
}): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    {
      id: opts.guildId,
      deny: [PermissionFlagsBits.Connect],
      allow: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: opts.botId,
      allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
    },
  ];
  for (const id of opts.allowedDiscordIds) {
    if (id === opts.botId || id === opts.guildId) continue;
    overwrites.push({
      id,
      allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
    });
  }
  return overwrites;
}

/**
 * Diff the channel's current member overwrites against the desired allow-list.
 * Returns the ids to add (newly rostered) and remove (stale). `@everyone` and
 * the bot are managed separately and must not be passed in `currentMemberIds`.
 */
export function reconcileMemberOverwrites(
  currentMemberIds: Iterable<string>,
  desiredIds: Set<string>,
): { toAdd: string[]; toRemove: string[] } {
  const current = new Set(currentMemberIds);
  const toAdd = [...desiredIds].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !desiredIds.has(id));
  return { toAdd, toRemove };
}
