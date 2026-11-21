/**
 * ROK-2274 — the pure half of signup lines inside a Raid Ledger event
 * thread: given the state last WRITTEN as a line per member (null = this
 * thread was never seeded) and every member's state now, the line rows to
 * insert and the state rows to upsert / drop. No Nest, no DB.
 *
 * Same text as the Discord line (`signupLineText`, one copy file, one
 * emoji source), naming the member instead of mentioning them. One row per
 * line — consecutive lines are never merged (ruling Q2). Members are keyed
 * `u:<userId>` / `d:<discordId>`, so local accounts get lines (Q5).
 */
import { UNICODE_FALLBACK } from '../../../discord-bot/services/discord-emoji.constants';
import {
  signupLineText,
  type SignupLineEmoji,
} from '../discord/hub-forum-discord-signup-lines';
import { UNKNOWN_MEMBER_NAME } from '../discord/hub-forum-discord-signup-lines.copy';
import { isResetMove } from '../discord/hub-forum-discord-signup-lines.flush';
import type { KeyedSignupLineMember } from '../discord/hub-forum-discord-signup-lines.queries';
import type { WrittenLineState } from '../../../drizzle/schema/hub-forum-signup-line-states';

/** The state row marking "this thread is seeded" — never a member key. */
export const SEED_MEMBER_KEY = '#seeded';

/** One line row to insert. */
export interface RlSignupLine {
  memberKey: string;
  /** The member's account (`subject_user_id`); null for a Discord guest. */
  subjectUserId: number | null;
  body: string;
}

/** What one RL flush writes. */
export interface RlLinePlan {
  /** First sight of the thread: states seeded, no lines (D4). */
  seed: boolean;
  lines: RlSignupLine[];
  /** State rows to upsert, by member key. */
  upsert: Map<string, WrittenLineState>;
  /** Member keys whose state row is dropped (their signup row is gone). */
  drop: string[];
}

type Members = ReadonlyMap<string, KeyedSignupLineMember>;
type Prior = ReadonlyMap<string, WrittenLineState>;

const SEED_STATE: WrittenLineState = {
  status: 'gone',
  role: null,
  bench: false,
  character: null,
  late: false,
  lateMinutes: null,
  roachedHoursBefore: null,
  name: '',
};

const ACCOUNT_KEY = /^u:(\d+)$/;

/** The account id in a `u:<id>` key; null for a guest key. */
export function userIdOfKey(memberKey: string): number | null {
  const id = ACCOUNT_KEY.exec(memberKey)?.[1];
  return id === undefined ? null : Number(id);
}

function written(member: KeyedSignupLineMember): WrittenLineState {
  return { ...member.state, name: member.displayName };
}

const ACTIVE = new Set(['signed_up', 'tentative']);

/** First sight: the marker plus every ACTIVE member as already written. */
function seedPlan(members: Members): RlLinePlan {
  const upsert = new Map<string, WrittenLineState>([
    [SEED_MEMBER_KEY, SEED_STATE],
  ]);
  for (const [key, member] of members) {
    if (ACTIVE.has(member.state.status)) upsert.set(key, written(member));
  }
  return { seed: true, lines: [], upsert, drop: [] };
}

/** A Discord custom emoji token (`<:rl_tank:123>`, animated `<a:…>`). */
const CUSTOM_EMOJI = /<a?:\w+:\d+>/;

/**
 * Codex P2-3 — the glyphs as plain text for the Raid Ledger thread, which
 * cannot render a Discord custom emoji token: a role token becomes its
 * Unicode fallback, a class token (none exists) is dropped.
 */
export function plainLineEmoji(discord: SignupLineEmoji): SignupLineEmoji {
  const plain = (glyph: string, fallback: string): string =>
    CUSTOM_EMOJI.test(glyph) ? fallback : glyph;
  return {
    role: (r) => plain(discord.role(r), UNICODE_FALLBACK[r] ?? ''),
    klass: (c) => plain(discord.klass(c), ''),
  };
}

/**
 * Codex P2-4 — a Discord guest who claims an account moves from `d:<id>`
 * to `u:<userId>`: their written state moves with them (upsert the new
 * key, drop the old) so the diff sees one member, not a leave + a join.
 * Skipped while the guest signup itself still exists.
 */
function claimedMoves(prior: Prior, members: Members): RlLinePlan {
  const upsert = new Map<string, WrittenLineState>();
  const drop: string[] = [];
  for (const [key, member] of members) {
    const guestKey = member.discordId === null ? null : `d:${member.discordId}`;
    if (guestKey === null || member.userId === null) continue;
    const was = prior.get(guestKey);
    if (!was || prior.has(key) || members.has(guestKey)) continue;
    upsert.set(key, was);
    drop.push(guestKey);
  }
  return { seed: false, lines: [], upsert, drop };
}

/** The prior states with the claimed moves applied. */
function movedPrior(
  prior: Prior,
  moves: RlLinePlan,
): Map<string, WrittenLineState> {
  const out = new Map(prior);
  for (const key of moves.drop) out.delete(key);
  for (const [key, state] of moves.upsert) out.set(key, state);
  return out;
}

/** Sync loop 3: a reset's own status move is written silently. */
function resynced(
  prior: Prior,
  members: Members,
): Map<string, WrittenLineState> {
  const out = new Map<string, WrittenLineState>();
  for (const [key, was] of prior) {
    const now = members.get(key)?.state.status;
    if (now !== undefined && isResetMove(was.status, now)) {
      out.set(key, { ...was, status: now });
    }
  }
  return out;
}

/**
 * The lines + state writes for one flush. `prior` null seeds; `resyncing`
 * (a confirmation reset is pending/landed) first moves reset statuses
 * silently, then any real change still gets its line.
 */
export function planRlLines(
  prior: Prior | null,
  members: Members,
  emoji: SignupLineEmoji,
  resyncing: boolean,
): RlLinePlan {
  if (prior === null) return seedPlan(members);
  const moves = claimedMoves(prior, members);
  const moved = movedPrior(prior, moves);
  const upsert = new Map(moves.upsert);
  if (resyncing)
    for (const [k, v] of resynced(moved, members)) upsert.set(k, v);
  const base = new Map([...moved, ...upsert]);
  const lines: RlSignupLine[] = [];
  const drop = [...moves.drop];
  for (const key of new Set([...base.keys(), ...members.keys()])) {
    const was = base.get(key) ?? null;
    const member = members.get(key);
    const name = member?.displayName ?? was?.name ?? UNKNOWN_MEMBER_NAME;
    const body = signupLineText(was, member?.state ?? null, name, emoji);
    if (body === null) continue;
    const subjectUserId = member ? member.userId : userIdOfKey(key);
    lines.push({ memberKey: key, subjectUserId, body });
    if (member) upsert.set(key, written(member));
    else drop.push(key);
  }
  return { seed: false, lines, upsert, drop };
}
