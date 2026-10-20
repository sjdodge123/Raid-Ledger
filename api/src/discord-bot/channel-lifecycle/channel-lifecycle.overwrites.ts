/**
 * ROK-1428 D6 (Codex r2): archive's permission-overwrite plan and its exact
 * inverse. Archive denies `@everyone` SendMessages + the thread send/create
 * bits (+ ViewChannel when hiding),
 * turns any other role/member Allow for those bits into a Deny (Codex r3), and
 * gives the bot's member overwrite an explicit allow for the same bits, so
 * the bot can still post (and see) while the channel is archived. Every bit it
 * changes is recorded with its PRIOR tri-state, and a restore writes those
 * priors back — a prior explicit Allow/Deny returns instead of being cleared.
 */
import {
  DiscordAPIError,
  OverwriteType,
  PermissionFlagsBits,
  type PermissionOverwriteManager,
  type PermissionOverwriteOptions,
  type PermissionOverwrites,
} from 'discord.js';
import type {
  ArchivedOverwriteChange,
  ArchivedOverwrites,
  OverwritePriorState,
} from '../../drizzle/schema/channel-bindings';

type Target = ArchivedOverwriteChange['target'];
type LockFlag = ArchivedOverwriteChange['flag'];

/** The snowflakes the two fixed targets resolve to. */
export interface OverwriteIds {
  everyoneId: string;
  botId: string;
}

/** One overwrite's changes, in write order. */
interface Group {
  id: string;
  type: OverwriteType;
  isBot: boolean;
  changes: ArchivedOverwriteChange[];
}

/**
 * Archive's state per target: `@everyone` denied, the bot explicitly allowed,
 * and every other role/member Allow for a locked bit turned into a Deny — an
 * explicit Allow on a "Members" role would otherwise beat the `@everyone` deny.
 */
const ARCHIVED: Record<Target, OverwritePriorState> = {
  everyone: 'deny',
  bot: 'allow',
  role: 'deny',
  member: 'deny',
};

/** Archive's read-only lock: posting AND thread replies/creation (Codex r4b). */
const SEND_FLAGS: LockFlag[] = [
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
];

/** Discord's "that role/user/member no longer exists" codes. */
const TARGET_GONE_CODES = new Set([10007, 10011, 10013]);

/** A null record = archived before the record existed: only the send lock. */
const LEGACY_CHANGES: ArchivedOverwriteChange[] = [
  { target: 'everyone', flag: 'SendMessages', prior: 'inherit' },
];

/** The overwrite id + type a change applies to. */
function keyOf(
  ids: OverwriteIds,
  c: ArchivedOverwriteChange,
): { id: string; type: OverwriteType } {
  if ('id' in c) {
    const isRole = c.target === 'role';
    return {
      id: c.id,
      type: isRole ? OverwriteType.Role : OverwriteType.Member,
    };
  }
  if (c.target === 'everyone')
    return { id: ids.everyoneId, type: OverwriteType.Role };
  return { id: ids.botId, type: OverwriteType.Member };
}
const toValue = (s: OverwritePriorState): boolean | null =>
  s === 'allow' ? true : s === 'deny' ? false : null;

/** The tri-state of `flag` on overwrite `ow`. */
function stateOf(
  ow: PermissionOverwrites | undefined,
  flag: LockFlag,
): OverwritePriorState {
  const bit = PermissionFlagsBits[flag];
  if (ow === undefined) return 'inherit';
  if ((ow.allow.bitfield & bit) !== 0n) return 'allow';
  return (ow.deny.bitfield & bit) !== 0n ? 'deny' : 'inherit';
}

/** Changes for every role/member overwrite (not `@everyone`, not the bot) that Allows a locked bit. */
function planOthers(
  po: PermissionOverwriteManager,
  ids: OverwriteIds,
  flags: LockFlag[],
): ArchivedOverwriteChange[] {
  const out: ArchivedOverwriteChange[] = [];
  for (const ow of po.cache.values()) {
    if (ow.id === ids.everyoneId || ow.id === ids.botId) continue;
    const target = ow.type === OverwriteType.Role ? 'role' : 'member';
    for (const flag of flags) {
      if (stateOf(ow, flag) === 'allow')
        out.push({ target, id: ow.id, flag, prior: 'allow' });
    }
  }
  return out;
}

/**
 * Every (target, flag) archive must change, with its prior state; bits
 * already in the archived state are left alone. Bot first, so a lock write
 * never removes the bot's access before granting it.
 */
export function planArchive(
  po: PermissionOverwriteManager,
  ids: OverwriteIds,
  hide: boolean,
): ArchivedOverwriteChange[] {
  const flags: LockFlag[] = hide ? [...SEND_FLAGS, 'ViewChannel'] : SEND_FLAGS;
  const changes: ArchivedOverwriteChange[] = [];
  for (const target of ['bot', 'everyone'] as const) {
    const ow = po.cache.get(target === 'bot' ? ids.botId : ids.everyoneId);
    for (const flag of flags) {
      const prior = stateOf(ow, flag);
      if (prior !== ARCHIVED[target]) changes.push({ target, flag, prior });
    }
  }
  return [...changes, ...planOthers(po, ids, flags)];
}

/** Normalise a stored record (v2, v1 booleans, or null) to its change list. */
export function toChanges(
  rec: ArchivedOverwrites | null | undefined,
): ArchivedOverwriteChange[] {
  if (!rec) return LEGACY_CHANGES;
  if ('changes' in rec) return rec.changes;
  const out: ArchivedOverwriteChange[] = [];
  const prior = 'inherit';
  if (rec.everyoneSend)
    out.push({ target: 'everyone', flag: 'SendMessages', prior });
  if (rec.everyoneView)
    out.push({ target: 'everyone', flag: 'ViewChannel', prior });
  if (rec.botView) out.push({ target: 'bot', flag: 'ViewChannel', prior });
  return out;
}

/** Group changes by overwrite, first-appearance order. */
function groupsOf(
  ids: OverwriteIds,
  changes: ArchivedOverwriteChange[],
): Group[] {
  const out = new Map<string, Group>();
  for (const c of changes) {
    const { id, type } = keyOf(ids, c);
    const g = out.get(id) ?? {
      id,
      type,
      isBot: c.target === 'bot',
      changes: [],
    };
    g.changes.push(c);
    out.set(id, g);
  }
  return [...out.values()];
}

/** `{flag: value}` for one overwrite's changes. */
function optionsFor(
  changes: ArchivedOverwriteChange[],
  pick: (c: ArchivedOverwriteChange) => OverwritePriorState,
): PermissionOverwriteOptions {
  const opts: PermissionOverwriteOptions = {};
  for (const c of changes) opts[c.flag] = toValue(pick(c));
  return opts;
}

/** Write archive's lock (bot allow first, so the bot never loses access). */
export async function writeLock(
  po: PermissionOverwriteManager,
  ids: OverwriteIds,
  changes: ArchivedOverwriteChange[],
): Promise<void> {
  const groups = groupsOf(ids, changes);
  const ordered = [
    ...groups.filter((g) => g.isBot),
    ...groups.filter((g) => !g.isBot),
  ];
  for (const g of ordered) {
    const opts = optionsFor(g.changes, (c) => ARCHIVED[c.target]);
    await po.edit(g.id, opts, { type: g.type });
  }
}

/** True when restoring `changes` would leave overwrite `ow` with no bits. */
function leavesEmpty(
  ow: PermissionOverwrites,
  changes: ArchivedOverwriteChange[],
): boolean {
  let allow = ow.allow.bitfield;
  let deny = ow.deny.bitfield;
  for (const c of changes) {
    const bit = PermissionFlagsBits[c.flag];
    allow = c.prior === 'allow' ? allow | bit : allow & ~bit;
    deny = c.prior === 'deny' ? deny | bit : deny & ~bit;
  }
  return allow === 0n && deny === 0n;
}

/**
 * Restore one group, skipping a role/member deleted while archived (Codex
 * r4b): Discord rejects the write, and a throw would fail every later
 * unarchive before the archived state is cleared.
 */
async function restoreGroupSafely(
  po: PermissionOverwriteManager,
  g: Group,
): Promise<void> {
  try {
    await restoreGroup(po, g);
  } catch (err) {
    const fixed = g.isBot || g.changes.some((c) => c.target === 'everyone');
    const gone =
      err instanceof DiscordAPIError &&
      typeof err.code === 'number' &&
      TARGET_GONE_CODES.has(err.code);
    if (fixed || !gone) throw err;
  }
}

/** Restore one overwrite's priors; an overwrite left empty is deleted. */
async function restoreGroup(
  po: PermissionOverwriteManager,
  g: Group,
): Promise<void> {
  const ow = po.cache.get(g.id);
  if (ow === undefined) {
    if (g.changes.every((c) => c.prior === 'inherit')) return;
  } else if (leavesEmpty(ow, g.changes)) {
    await po.delete(g.id);
    return;
  }
  await po.edit(
    g.id,
    optionsFor(g.changes, (c) => c.prior),
    { type: g.type },
  );
}

/**
 * Write each changed bit's prior state back. `po` must be a FRESH read (the
 * gateway cache may predate the archive's writes). The bot last, so it keeps
 * access until the channel is open again.
 */
export async function restorePriors(
  po: PermissionOverwriteManager,
  ids: OverwriteIds,
  changes: ArchivedOverwriteChange[],
): Promise<void> {
  const groups = groupsOf(ids, changes);
  const ordered = [
    ...groups.filter((g) => !g.isBot),
    ...groups.filter((g) => g.isBot),
  ];
  for (const g of ordered) await restoreGroupSafely(po, g);
}
