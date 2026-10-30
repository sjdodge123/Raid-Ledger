/**
 * ROK-1785 L6 — the request context and response shape of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture (`demo-test-guild.controller.ts`),
 * split out so the controller stays under the max-lines limit (ROK-1917).
 */
import { defined } from '../common/defined.helpers';
import type { SeedGuildRole } from './demo-test-guild.helpers';
import type { SeededGuildRaids } from './demo-test-guild-raids.helpers';
import type { SeedGuildContent } from './demo-test-guild-content.helpers';
import type {
  SeedLockoutOwner,
  SeededGuildLockouts,
} from './demo-test-guild-lockouts.helpers';
import type { SeededGuildGear } from './demo-test-guild-gear.helpers';
import type { SeededGuildDings } from './demo-test-guild-dings.helpers';
import type { SeededGuildPresence } from './demo-test-guild-presence.helpers';
import type { SeededGuildPulls } from './demo-test-guild-pulls.helpers';

export interface RosterCtx {
  guildId: number;
  gameId: number;
  hash: string;
  now: Date;
}

export interface SeedGuildUser {
  userId: number;
  username: string;
  discordId: string;
  /** Null for `outsider`. */
  characterId: string | null;
  /** Null for `outsider`. */
  memberId: number | null;
  rankIndex: number | null;
}

export interface SeedGuildResponse {
  guildId: number;
  gameId: number;
  name: string;
  editorId: number;
  editorRankIndex: number;
  users: Record<SeedGuildRole, SeedGuildUser>;
  /** Roster rows with no RL character (ranks 2 and 4). */
  unlinkedMemberIds: number[];
  /** ROK-1787 — guild-tagged events for the Raids tab. */
  raids: SeededGuildRaids;
  /** Present only when the body sent `withContent: true`. */
  content?: SeedGuildContent;
  /** Present only when the body sent `withLockouts: true`. */
  lockouts?: SeededGuildLockouts;
  /** Present only when the body sent `withDings: true` (ROK-1919). */
  dings?: SeededGuildDings;
  /** Present only when the body sent `withPresence: true` (ROK-1916). */
  presence?: SeededGuildPresence;
  /** Present only when the body sent `withGear: true` (ROK-1915). */
  gear?: SeededGuildGear;
  /** Present only when the body sent `withPulls: true` (ROK-1917). */
  pulls?: SeededGuildPulls;
}

/** The opt-in halves `seedOptional` adds to the response. */
export type SeedGuildExtras = Pick<
  SeedGuildResponse,
  'content' | 'lockouts' | 'dings' | 'presence' | 'gear' | 'pulls'
>;

export interface SeededRoster {
  users: Record<SeedGuildRole, SeedGuildUser>;
  unlinked: number[];
}

/** The three linked owners' character ids (every seeded linked user has one). */
export function snapshotOwners(
  users: Record<SeedGuildRole, SeedGuildUser>,
): Record<SeedLockoutOwner, string> {
  const id = (owner: SeedLockoutOwner): string =>
    defined(users[owner].characterId ?? undefined, `seeded ${owner} character`);
  return { gm: id('gm'), officer: id('officer'), member: id('member') };
}
