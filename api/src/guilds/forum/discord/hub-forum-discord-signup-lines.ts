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
 * All wording lives in `hub-forum-discord-signup-lines.copy.ts`.
 */
import {
  BENCH_LABEL,
  DETAIL_SEPARATOR,
  NO_ROLE_LABEL,
  PART_SEPARATOR,
  ROLE_LABELS,
  SIGNUP_LINE_COPY as COPY,
} from './hub-forum-discord-signup-lines.copy';

/** The character a signup is on, as far as a line goes. */
export interface SignupLineCharacter {
  name: string;
  className: string | null;
  spec: string | null;
}

/**
 * A member's line-relevant signup state. JSON-safe (no Date) so the caller
 * can store the last POSTED one as-is (e.g. a Redis hash field).
 */
export interface SignupLineState {
  /** `event_signups.status`; `'gone'` when the row no longer exists. */
  status: string;
  /** Roster slot role (tank/healer/dps/flex); null when unassigned/benched. */
  role: string | null;
  bench: boolean;
  character: SignupLineCharacter | null;
  late: boolean;
  lateMinutes: number | null;
  /** Hours between the roach-out and the event start; null if not roached. */
  roachedHoursBefore: number | null;
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
export function characterLabel(ch: SignupLineCharacter): string {
  const kind = [ch.spec, ch.className].filter((p) => !!p).join(' ');
  return kind ? `${ch.name} (${kind})` : ch.name;
}

/** `<1` under an hour, whole hours otherwise. */
export function hoursLabel(hours: number): string {
  return hours < 1 ? '<1' : String(Math.round(hours));
}

/** ` — Tank · Thrall (Prot Warrior)`, or '' when neither is known. */
function detail(s: SignupLineState): string {
  const parts: string[] = [];
  if (s.bench) parts.push(BENCH_LABEL);
  else if (s.role !== null) parts.push(roleLabel(s.role));
  if (s.character) parts.push(characterLabel(s.character));
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

function rosterFragments(
  prev: SignupLineState,
  cur: SignupLineState,
): Fragment[] {
  if (!prev.bench && cur.bench) return [COPY.benched];
  if (prev.bench && !cur.bench) {
    const to = cur.role === null ? '' : ` → ${roleLabel(cur.role)}`;
    return [{ emoji: COPY.promoted.emoji, text: COPY.promoted.text + to }];
  }
  if (cur.bench || prev.role === cur.role) return [];
  const text = COPY.roleChange.text(roleLabel(prev.role), roleLabel(cur.role));
  return [{ emoji: COPY.roleChange.emoji, text }];
}

function characterFragments(
  prev: SignupLineState,
  cur: SignupLineState,
): Fragment[] {
  if (cur.character === null) return [];
  const was = prev.character ? characterLabel(prev.character) : null;
  const now = characterLabel(cur.character);
  if (was === now) return [];
  return [
    { emoji: COPY.characterChange.emoji, text: COPY.characterChange.text(now) },
  ];
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

/** Every change between two ACTIVE states, in reading order. */
export function changeFragments(
  prev: SignupLineState,
  cur: SignupLineState,
): Fragment[] {
  return [
    ...statusFragment(prev, cur),
    ...rosterFragments(prev, cur),
    ...characterFragments(prev, cur),
    ...lateFragments(prev, cur),
  ];
}

function render(who: string, frags: readonly Fragment[], suffix = ''): string {
  const [first] = frags;
  const emoji = first ? first.emoji : '';
  const text = frags.map((f) => f.text).join(PART_SEPARATOR);
  return `${emoji} ${who} ${text}${suffix}`;
}

/** The one line to post for a member, or null when nothing changed. */
export function signupLine(input: SignupLineInput): SignupLine | null {
  const { previous: prev, current: cur } = input;
  const wasActive = isActiveSignup(prev);
  if (!isActiveSignup(cur)) {
    if (!wasActive) return null;
    return line(input, false, [leaveFragment(cur)]);
  }
  const mention = !input.mentioned;
  if (prev === null || !wasActive) {
    const frag = joinFragment(cur, prev !== null);
    return line(input, mention, [frag], detail(cur));
  }
  const frags = changeFragments(prev, cur);
  if (frags.length === 0) return null;
  return line(input, mention, frags);
}

function line(
  input: SignupLineInput,
  mention: boolean,
  frags: readonly Fragment[],
  suffix = '',
): SignupLine {
  const who = mention ? `<@${input.discordId}>` : input.displayName;
  return {
    discordId: input.discordId,
    content: render(who, frags, suffix),
    mention,
  };
}

/** Lines for a whole flush, input order, unchanged members dropped. */
export function signupLines(inputs: readonly SignupLineInput[]): SignupLine[] {
  return inputs
    .map((input) => signupLine(input))
    .filter((l): l is SignupLine => l !== null);
}
