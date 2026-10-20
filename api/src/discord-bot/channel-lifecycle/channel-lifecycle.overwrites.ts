/**
 * ROK-1428 D6 (Codex r2): archive's permission-overwrite plan and its exact
 * inverse. Archive denies `@everyone` SendMessages (+ ViewChannel when hiding)
 * and gives the bot's member overwrite an explicit allow for the same bits, so
 * the bot can still post (and see) while the channel is archived. Every bit it
 * changes is recorded with its PRIOR tri-state, and a restore writes those
 * priors back — a prior explicit Allow/Deny returns instead of being cleared.
 */
import {
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

/** The snowflakes the two targets resolve to. */
export interface OverwriteIds {
  everyoneId: string;
  botId: string;
}

/** Archive's state per target: `@everyone` denied, the bot explicitly allowed. */
const ARCHIVED: Record<Target, OverwritePriorState> = {
  everyone: 'deny',
  bot: 'allow',
};

/** A null record = archived before the record existed: only the send lock. */
const LEGACY_CHANGES: ArchivedOverwriteChange[] = [
  { target: 'everyone', flag: 'SendMessages', prior: 'inherit' },
];

const idOf = (ids: OverwriteIds, t: Target): string =>
  t === 'everyone' ? ids.everyoneId : ids.botId;
const typeOf = (t: Target): OverwriteType =>
  t === 'everyone' ? OverwriteType.Role : OverwriteType.Member;
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
  const flags: LockFlag[] = hide
    ? ['SendMessages', 'ViewChannel']
    : ['SendMessages'];
  const changes: ArchivedOverwriteChange[] = [];
  for (const target of ['bot', 'everyone'] as const) {
    const ow = po.cache.get(idOf(ids, target));
    for (const flag of flags) {
      const prior = stateOf(ow, flag);
      if (prior !== ARCHIVED[target]) changes.push({ target, flag, prior });
    }
  }
  return changes;
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

/** `{flag: value}` for one target's changes, or null when it has none. */
function optionsFor(
  changes: ArchivedOverwriteChange[],
  target: Target,
  pick: (c: ArchivedOverwriteChange) => OverwritePriorState,
): PermissionOverwriteOptions | null {
  const mine = changes.filter((c) => c.target === target);
  if (mine.length === 0) return null;
  const opts: PermissionOverwriteOptions = {};
  for (const c of mine) opts[c.flag] = toValue(pick(c));
  return opts;
}

/** Write archive's lock (bot allow first, so the bot never loses access). */
export async function writeLock(
  po: PermissionOverwriteManager,
  ids: OverwriteIds,
  changes: ArchivedOverwriteChange[],
): Promise<void> {
  for (const target of ['bot', 'everyone'] as const) {
    const opts = optionsFor(changes, target, (c) => ARCHIVED[c.target]);
    if (opts) await po.edit(idOf(ids, target), opts, { type: typeOf(target) });
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

/** Restore one target's priors; an overwrite left empty is deleted. */
async function restoreTarget(
  po: PermissionOverwriteManager,
  ids: OverwriteIds,
  target: Target,
  changes: ArchivedOverwriteChange[],
): Promise<void> {
  const opts = optionsFor(changes, target, (c) => c.prior);
  if (!opts) return;
  const id = idOf(ids, target);
  const mine = changes.filter((c) => c.target === target);
  const ow = po.cache.get(id);
  if (ow === undefined) {
    if (mine.every((c) => c.prior === 'inherit')) return;
  } else if (leavesEmpty(ow, mine)) {
    await po.delete(id);
    return;
  }
  await po.edit(id, opts, { type: typeOf(target) });
}

/**
 * Write each changed bit's prior state back. `po` must be a FRESH read (the
 * gateway cache may predate the archive's writes). `@everyone` first, so the
 * bot keeps access until the channel is open again.
 */
export async function restorePriors(
  po: PermissionOverwriteManager,
  ids: OverwriteIds,
  changes: ArchivedOverwriteChange[],
): Promise<void> {
  await restoreTarget(po, ids, 'everyone', changes);
  await restoreTarget(po, ids, 'bot', changes);
}
