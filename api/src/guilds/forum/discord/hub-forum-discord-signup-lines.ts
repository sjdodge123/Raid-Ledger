/**
 * ROK-2271 — the pure half of "signup lines carry role, character and
 * status": given what was last POSTED about a member in an event's Discord
 * thread and their state NOW, the one line to post (or null when nothing a
 * reader cares about changed). No Nest, no DB, no Discord.
 *
 * Mention-once (Lead call 2026-11-20): a member is `<@id>`-mentioned only
 * while not yet mentioned in the thread (their first line — the mention is
 * what adds them to it); every later line names them without a ping. The
 * caller owns the "mentioned" flag and clears it when it removes the member
 * from the thread, so a re-signup is mentioned (re-added) again.
 * All wording lives in `hub-forum-discord-signup-lines.copy.ts`; role and
 * class glyphs come from the caller's `SignupLineEmoji` (ROK-2273).
 */
import { escapeMarkdown } from 'discord.js';
import type { DiscordEmojiService } from '../../../discord-bot/services/discord-emoji.service';
import {
  BENCH_LABEL,
  DETAIL_SEPARATOR,
  NO_ROLE_LABEL,
  PART_SEPARATOR,
  ROLE_LABELS,
  SIGNUP_LINE_COPY as COPY,
} from './hub-forum-discord-signup-lines.copy';
import type {
  SignupLineCharacter,
  SignupLineState,
} from '../../../drizzle/schema/hub-forum-signup-line-states';

/** The persisted line shapes live with their table (ROK-2274 layering). */
export type { SignupLineCharacter, SignupLineState };

/**
 * ROK-2273 — the per-guild role / class glyphs, resolved by the same
 * `DiscordEmojiService` calls the channel embed makes, so a line and the
 * embed show the same (custom or Unicode) emoji. '' = no glyph.
 */
export interface SignupLineEmoji {
  role(role: string): string;
  klass(className: string): string;
}

/** The resolver over `DiscordEmojiService` — the embed's own two calls. */
export function signupLineEmoji(
  svc: Pick<DiscordEmojiService, 'getRoleEmoji' | 'getClassEmoji'>,
): SignupLineEmoji {
  return {
    role: (r) => svc.getRoleEmoji(r),
    klass: (c) => svc.getClassEmoji(c),
  };
}

/** One member's input to a flush. */
export interface SignupLineInput {
  discordId: string;
  displayName: string;
  /** Last posted state; null = nothing posted about them yet. */
  previous: SignupLineState | null;
  /** State now; null = no signup row (treated as `'gone'`). */
  current: SignupLineState | null;
  /** Already @mentioned (= in the thread) since their last removal. */
  mentioned: boolean;
}

/** One line to post. `mention` = the line pings `discordId`. */
export interface SignupLine {
  discordId: string;
  content: string;
  mention: boolean;
}

interface Fragment {
  emoji: string;
  text: string;
}

/** Player text as a surface shows it: Discord-escaped, or plain (RL). */
type Escape = (text: string) => string;
const PLAIN: Escape = (text) => text;

const ACTIVE = new Set(['signed_up', 'tentative']);

/** Active = can post in the thread (signed_up / tentative, bench incl.). */
export function isActiveSignup(
  state: SignupLineState | null,
): state is SignupLineState {
  return state !== null && ACTIVE.has(state.status);
}

export function roleLabel(role: string | null): string {
  if (role === null) return NO_ROLE_LABEL;
  return ROLE_LABELS[role] ?? role;
}

/** `Thrall (Prot Warrior)` / `Thrall (Warrior)` / `Thrall`. */
export function characterLabel(
  ch: SignupLineCharacter,
  esc: Escape = escapeMarkdown,
): string {
  const kind = [ch.spec, ch.className].filter((p) => !!p).join(' ');
  // Review MINOR-3: a name is player text, never formatting (on Discord).
  const name = esc(ch.name);
  return kind ? `${name} (${esc(kind)})` : name;
}

/** `<1` under an hour, whole hours otherwise. */
export function hoursLabel(hours: number): string {
  return hours < 1 ? '<1' : String(Math.round(hours));
}

function roleGlyph(role: string | null, emoji: SignupLineEmoji): string {
  return role === null ? '' : emoji.role(role);
}

function classGlyph(ch: SignupLineCharacter, emoji: SignupLineEmoji): string {
  return ch.className ? emoji.klass(ch.className) : '';
}

/** `🛡️ Tank`, or the bare label when there is no glyph. */
function withGlyph(glyph: string, label: string): string {
  return glyph ? `${glyph} ${label}` : label;
}

/** ` — 🛡️ Tank · Thrall (Prot Warrior)`, or '' when neither is known. */
function detail(
  s: SignupLineState,
  emoji: SignupLineEmoji,
  esc: Escape,
): string {
  const parts: string[] = [];
  if (s.bench) parts.push(BENCH_LABEL);
  else if (s.role !== null) {
    parts.push(withGlyph(emoji.role(s.role), roleLabel(s.role)));
  }
  if (s.character) {
    const ch = s.character;
    parts.push(withGlyph(classGlyph(ch, emoji), characterLabel(ch, esc)));
  }
  return parts.length ? DETAIL_SEPARATOR + parts.join(PART_SEPARATOR) : '';
}

/** The line for a member who just became active (first signup or back). */
function joinFragment(cur: SignupLineState, wasHere: boolean): Fragment {
  const tentative = cur.status === 'tentative';
  if (wasHere) return tentative ? COPY.backTentative : COPY.back;
  return tentative ? COPY.tentative : COPY.signedUp;
}

/** The line for a member who just stopped being active. */
function leaveFragment(cur: SignupLineState | null): Fragment {
  if (cur?.status === 'roached_out') {
    const h = cur.roachedHoursBefore;
    if (h === null) return COPY.roachedOut;
    return {
      emoji: COPY.roachedOutHours.emoji,
      text: COPY.roachedOutHours.text(hoursLabel(h)),
    };
  }
  if (cur?.status === 'departed') return COPY.departed;
  return COPY.declined;
}

function statusFragment(
  prev: SignupLineState,
  cur: SignupLineState,
): Fragment[] {
  if (prev.status === cur.status) return [];
  return [cur.status === 'signed_up' ? COPY.confirmed : COPY.nowTentative];
}

/** A promotion / role change leads with the NEW role's glyph (ROK-2273). */
function rosterFragments(
  prev: SignupLineState,
  cur: SignupLineState,
  emoji: SignupLineEmoji,
): Fragment[] {
  if (!prev.bench && cur.bench) return [COPY.benched];
  const glyph = roleGlyph(cur.role, emoji);
  if (prev.bench && !cur.bench) {
    const to = cur.role === null ? '' : ` → ${roleLabel(cur.role)}`;
    const text = COPY.promoted.text + to;
    return [{ emoji: glyph || COPY.promoted.emoji, text }];
  }
  if (cur.bench || prev.role === cur.role) return [];
  const text = COPY.roleChange.text(roleLabel(prev.role), roleLabel(cur.role));
  return [{ emoji: glyph || COPY.roleChange.emoji, text }];
}

/** Leads with the new character's class glyph, never a role glyph. */
function characterFragments(
  prev: SignupLineState,
  cur: SignupLineState,
  emoji: SignupLineEmoji,
  esc: Escape,
): Fragment[] {
  if (cur.character === null) return [];
  const was = prev.character ? characterLabel(prev.character, esc) : null;
  const now = characterLabel(cur.character, esc);
  if (was === now) return [];
  const glyph = classGlyph(cur.character, emoji) || COPY.characterChange.emoji;
  return [{ emoji: glyph, text: COPY.characterChange.text(now) }];
}

function lateFragments(
  prev: SignupLineState,
  cur: SignupLineState,
): Fragment[] {
  if (!prev.late && cur.late) {
    const m = cur.lateMinutes;
    if (m === null) return [COPY.late];
    return [{ emoji: COPY.lateMinutes.emoji, text: COPY.lateMinutes.text(m) }];
  }
  if (prev.late && !cur.late) return [COPY.onTime];
  return [];
}

/**
 * Codex P2-2 (review round 3): lateness set before the member's first line
 * is announced with it — the line's state is stored as posted, so it would
 * never be announced otherwise.
 */
function joinLate(cur: SignupLineState): Fragment[] {
  return cur.late ? lateFragments({ ...cur, late: false }, cur) : [];
}

/** Every change between two ACTIVE states, in reading order. */
export function changeFragments(
  prev: SignupLineState,
  cur: SignupLineState,
  emoji: SignupLineEmoji,
  esc: Escape = escapeMarkdown,
): Fragment[] {
  return [
    ...statusFragment(prev, cur),
    ...rosterFragments(prev, cur, emoji),
    ...characterFragments(prev, cur, emoji, esc),
    ...lateFragments(prev, cur),
  ];
}

function render(who: string, frags: readonly Fragment[], suffix = ''): string {
  const [first] = frags;
  const emoji = first ? first.emoji : '';
  const text = frags.map((f) => f.text).join(PART_SEPARATOR);
  return `${emoji} ${who} ${text}${suffix}`;
}

/** A line before it names anyone; `mayMention` = not a leave line. */
interface LineParts {
  frags: Fragment[];
  suffix: string;
  mayMention: boolean;
}

/** What a member's line says, or null when nothing a reader cares about changed. */
function lineParts(
  prev: SignupLineState | null,
  cur: SignupLineState | null,
  emoji: SignupLineEmoji,
  esc: Escape,
): LineParts | null {
  const wasActive = isActiveSignup(prev);
  if (!isActiveSignup(cur)) {
    if (!wasActive) return null;
    return { frags: [leaveFragment(cur)], suffix: '', mayMention: false };
  }
  if (prev === null || !wasActive) {
    const frags = [joinFragment(cur, prev !== null), ...joinLate(cur)];
    return { frags, suffix: detail(cur, emoji, esc), mayMention: true };
  }
  const frags = changeFragments(prev, cur, emoji, esc);
  return frags.length === 0 ? null : { frags, suffix: '', mayMention: true };
}

/** The one line to post for a member, or null when nothing changed. */
export function signupLine(
  input: SignupLineInput,
  emoji: SignupLineEmoji,
): SignupLine | null {
  const parts = lineParts(input.previous, input.current, emoji, escapeMarkdown);
  if (!parts) return null;
  const mention = parts.mayMention && !input.mentioned;
  const who = mention
    ? `<@${input.discordId}>`
    : escapeMarkdown(input.displayName);
  return {
    discordId: input.discordId,
    content: render(who, parts.frags, parts.suffix),
    mention,
  };
}

/**
 * ROK-2274 — the same line as plain text naming `name` (never a mention):
 * what a Raid Ledger event thread shows. Same copy, same glyphs.
 */
export function signupLineText(
  prev: SignupLineState | null,
  cur: SignupLineState | null,
  name: string,
  emoji: SignupLineEmoji,
): string | null {
  const parts = lineParts(prev, cur, emoji, PLAIN);
  return parts ? render(name, parts.frags, parts.suffix) : null;
}

/** Lines for a whole flush, input order, unchanged members dropped. */
export function signupLines(
  inputs: readonly SignupLineInput[],
  emoji: SignupLineEmoji,
): SignupLine[] {
  return inputs
    .map((input) => signupLine(input, emoji))
    .filter((l): l is SignupLine => l !== null);
}
