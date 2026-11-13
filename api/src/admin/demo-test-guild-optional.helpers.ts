/**
 * The opt-in halves of `POST /admin/test/wow/seed-guild`, moved out of
 * `demo-test-guild.controller.ts` for the 300-line limit (ROK-1789 B9):
 * `armoryProfessions` (ROK-2107), `withContent` (ROK-1786), `withLockouts`
 * (ROK-1914), `withDings` (ROK-1919), `withPresence` (ROK-1916), `withGear`
 * (ROK-1915), `withPulls` (ROK-1917), `withInstalledAddons` (ROK-2147),
 * `withArmorySnapshots` (ROK-2149), `withRecruitment` (ROK-1789) and
 * `withActivity` (ROK-1789 B9 — runs after the pulls half, whose wipe it relies on).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import type { SeedGuildInput, SeedGuildRole } from './demo-test-guild.helpers';
import { seedContentHalf } from './demo-test-guild-content.helpers';
import { seedInstalledAddons } from './demo-test-guild-installed-addons.helpers';
import { seedGuildLockouts } from './demo-test-guild-lockouts.helpers';
import { seededGear } from './demo-test-guild-gear.helpers';
import {
  snapshotOwners,
  type RosterCtx,
  type SeedGuildExtras,
  type SeedGuildResponse,
  type SeedGuildUser,
  type SeededRoster,
} from './demo-test-guild.response';
import {
  seedGuildPulls,
  type SeedPullsInput,
} from './demo-test-guild-pulls.helpers';
import { applyArmoryProfessions } from './demo-test-guild-professions.helpers';
import { seedArmoryHalf } from './demo-test-guild-armory.helpers';
import { seedRecruitmentHalf } from './demo-test-guild-recruitment.helpers';
import { seedGuildDings } from './demo-test-guild-dings.helpers';
import { seedGuildPresence } from './demo-test-guild-presence.helpers';
import { seedGuildActivity } from './demo-test-guild-activity.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Users = Record<SeedGuildRole, SeedGuildUser>;
type Half = Promise<Partial<SeedGuildExtras>>;

/** What the halves need from the controller. */
export interface OptionalDeps {
  db: Db;
  /** Drops the guild's 5-minute roster-insights cache (WowCommonModule owns it). */
  invalidateInsights: (guildId: number) => void;
}

/** The roster plus the `memberCount` filler rows. */
export type ShowcaseRoster = SeededRoster & { fillers: number[] };

/** Runs every asked-for half, in order; each reports only when asked. */
export async function seedOptionalHalves(
  deps: OptionalDeps,
  input: SeedGuildInput,
  ctx: RosterCtx,
  roster: ShowcaseRoster,
): Promise<SeedGuildExtras> {
  const { db } = deps;
  const { users, unlinked } = roster;
  const gm = users.gm.userId;
  await applyArmoryProfessions(db, users, input.armoryProfessions);
  const snapshots = await snapshotHalves(deps, users, ctx, input);
  const dings = await dingsHalf(deps, input, roster, ctx);
  const presence = await presenceHalf(deps, input, roster, ctx.guildId);
  const pulls = await pullsHalf(deps, users, ctx, input);
  const activity = await activityHalf(deps, input, roster, ctx);
  const installed = await installedHalf(deps, input, users, ctx);
  return {
    ...(await seedContentHalf(db, input, ctx.guildId, gm, ctx.now)),
    ...snapshots,
    ...dings,
    ...presence,
    ...pulls,
    ...activity,
    ...installed,
    ...(await seedArmoryHalf(db, input, unlinked, ctx.now)),
    ...(await seedRecruitmentHalf(db, input, ctx.guildId, gm, ctx.now)),
  };
}

/** `withInstalledAddons` (ROK-2147): the member character's installed-addon list. */
async function installedHalf(
  { db }: OptionalDeps,
  input: Pick<SeedGuildInput, 'withInstalledAddons'>,
  users: Users,
  ctx: RosterCtx,
): Half {
  if (!input.withInstalledAddons) return {};
  const member = snapshotOwners(users).member;
  return { installedAddons: await seedInstalledAddons(db, member, ctx.now) };
}

/** `withLockouts` / `withGear`: one snapshot write per linked character, each half reported only when asked. */
async function snapshotHalves(
  deps: OptionalDeps,
  users: Users,
  ctx: RosterCtx,
  input: Pick<SeedGuildInput, 'withLockouts' | 'withGear'>,
): Promise<Pick<SeedGuildResponse, 'lockouts' | 'gear'>> {
  if (!input.withLockouts && !input.withGear) return {};
  const ids = snapshotOwners(users);
  const owners = (['gm', 'officer', 'member'] as const).map((owner) => ({
    owner,
    characterId: ids[owner],
  }));
  const lockouts = await seedGuildLockouts(deps.db, owners, ctx.now, {
    lockouts: input.withLockouts,
    gear: input.withGear,
  });
  deps.invalidateInsights(ctx.guildId);
  return {
    ...(input.withLockouts ? { lockouts } : {}),
    ...(input.withGear ? { gear: seededGear(ids) } : {}),
  };
}

/** ROK-1916 — presence on the five fixed roster rows, then a fresh insights cache. */
async function presenceHalf(
  deps: OptionalDeps,
  input: Pick<SeedGuildInput, 'withPresence'>,
  { users, unlinked }: SeededRoster,
  guildId: number,
): Half {
  if (!input.withPresence) return {};
  const memberOf = (role: SeedGuildRole): number =>
    defined(users[role].memberId ?? undefined, `seeded ${role} member`);
  const presence = await seedGuildPresence(deps.db, {
    gm: memberOf('gm'),
    officer: memberOf('officer'),
    member: memberOf('member'),
    unlinked: [
      defined(unlinked[0], 'seeded unlinked member'),
      defined(unlinked[1], 'seeded second unlinked member'),
    ],
  });
  deps.invalidateInsights(guildId);
  return { presence };
}

/** The pulls' reporters + scope (also the activity half's pull input). */
function pullsInput(
  users: Users,
  ctx: RosterCtx,
  name: string,
): SeedPullsInput {
  return {
    gameId: ctx.gameId,
    guildKey: name.toLowerCase(),
    reporters: {
      gm: users.gm.userId,
      officer: users.officer.userId,
      outsider: users.outsider.userId,
    },
    now: ctx.now,
  };
}

/** ROK-1917 — boss pulls exported by the linked gm/officer (+ one untrusted). */
async function pullsHalf(
  deps: OptionalDeps,
  users: Users,
  ctx: RosterCtx,
  input: Pick<SeedGuildInput, 'name' | 'withPulls'>,
): Half {
  if (!input.withPulls) return {};
  const pulls = await seedGuildPulls(
    deps.db,
    pullsInput(users, ctx, input.name),
  );
  deps.invalidateInsights(ctx.guildId);
  return { pulls };
}

/** ROK-1789 B9 — backdated joins/milestones, guild events and extra first kills. */
async function activityHalf(
  deps: OptionalDeps,
  input: Pick<SeedGuildInput, 'name' | 'withActivity'>,
  { users, fillers }: ShowcaseRoster,
  ctx: RosterCtx,
): Half {
  if (!input.withActivity) return {};
  const activity = await seedGuildActivity(deps.db, {
    guildId: ctx.guildId,
    gameId: ctx.gameId,
    creatorId: users.gm.userId,
    fillerIds: fillers,
    pulls: pullsInput(users, ctx, input.name),
  });
  deps.invalidateInsights(ctx.guildId);
  return { activity };
}

/** ROK-1919 — three level-up events: GM (linked), an unlinked row, member (31 days old). */
async function dingsHalf(
  { db }: OptionalDeps,
  input: Pick<SeedGuildInput, 'withDings'>,
  { users, unlinked }: SeededRoster,
  ctx: RosterCtx,
): Half {
  if (!input.withDings) return {};
  const members = {
    linked: defined(users.gm.memberId ?? undefined, 'seeded gm member'),
    unlinked: defined(unlinked[0], 'seeded unlinked member'),
    old: defined(users.member.memberId ?? undefined, 'seeded member member'),
  };
  return { dings: await seedGuildDings(db, ctx.guildId, members, ctx.now) };
}
