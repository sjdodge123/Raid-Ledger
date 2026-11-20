/**
 * ROK-2272 S10 (R5) — pure half of the poll voter ping: a voter's first
 * committed vote on a poll pings them once into the poll's Discord post
 * (`🗳 <@id> voted`), which is what adds them to the post (Discord thread
 * rule). The once-key is per post scope + user, so a re-created post pings
 * each voter again on their next vote (plan A4).
 */

/** Same glyph as the poll embed's author line (U+1F5F3, no VS16). */
export const VOTER_PING_COPY = { emoji: '\u{1F5F3}', text: 'voted' } as const;

/** A claimed voter once-key outlives any poll by far. */
export const VOTER_ONCE_TTL_SECONDS = 30 * 24 * 3600;

/** Which post a ping lands in: a hub thread's post or a registry post. */
export type VoterPingScope =
  { hubThreadId: number } | { planningPostId: number };

/** Why a voter ping did or did not go out. */
export type VoterPingOutcome =
  | 'pinged'
  | 'cleared'
  | 'no-post'
  | 'closed-post'
  | 'pending'
  | 'unlinked'
  | 'offline'
  | 'already'
  | 'send-failed';

/** `hub:<threadId>` / `planning:<postId>` — disjoint by construction. */
export function voterScopeKey(scope: VoterPingScope): string {
  if ('hubThreadId' in scope) return `hub:${scope.hubThreadId}`;
  return `planning:${scope.planningPostId}`;
}

/** Redis key that lets exactly one vote ping `userId` into a post. */
export function voterOnceKey(scope: VoterPingScope, userId: number): string {
  return `hfd:voter:${voterScopeKey(scope)}:${userId}`;
}

/** The ping line, e.g. `🗳 <@123> voted`. */
export function voterPingLine(discordId: string): string {
  return `${VOTER_PING_COPY.emoji} <@${discordId}> ${VOTER_PING_COPY.text}`;
}

/** A real Discord snowflake; `local:` / `unlinked:` / null are not linked. */
export function linkedDiscordId(raw: string | null): string | null {
  return raw !== null && /^\d+$/.test(raw) ? raw : null;
}
