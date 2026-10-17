/**
 * ROK-1830 S2b — the WoW hub kind's own rules, moved verbatim out of
 * `guilds/guild-access.service.spec.ts` when membership / rank / delegation
 * left core. The membership query (`findLinkedMemberRows`) and the delegation
 * lookup both end at `.where()`; the SQL semantics of soft removal and
 * deactivation are proven in `guilds/guild-access.integration.spec.ts`.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../../../common/testing/drizzle-mock';
import type * as schema from '../../../drizzle/schema';
import type { GuildActor } from '../../../guilds/guild-access.service';
import {
  GM_RANK_IMPLIES_EDIT,
  WowHubKindAdapter,
} from './wow-hub-kind.adapter';
import type { LinkedMemberRow } from './guild-membership.helpers';

const GUILD = 7;
const member = (id: number, rankIndex: number | null): LinkedMemberRow => ({
  guildId: GUILD,
  memberId: id,
  rankIndex,
});
const actor = (role: GuildActor['role']): GuildActor => ({ id: 42, role });

let db: MockDb;
let adapter: WowHubKindAdapter;

beforeEach(() => {
  db = createDrizzleMock();
  const asDb: unknown = db;
  adapter = new WowHubKindAdapter(asDb as PostgresJsDatabase<typeof schema>);
});

/** Queue the membership rows, then the delegation grants (if queried). */
function queue(rows: LinkedMemberRow[], grants: { id: number }[] = []) {
  db.where.mockResolvedValueOnce(rows).mockResolvedValueOnce(grants);
}

describe('WowHubKindAdapter identity', () => {
  it('claims the wow_guild kind for the wow-common plugin', () => {
    expect(adapter.kind).toBe('wow_guild');
    expect(adapter.pluginSlug).toBe('blizzard');
  });
});

describe('WowHubKindAdapter.resolveLadder', () => {
  it.each(['admin', 'operator'] as const)(
    '%s is leader without any member row',
    async (role) => {
      expect(await adapter.resolveLadder(actor(role), GUILD)).toBe('leader');
      expect(db.select).not.toHaveBeenCalled();
    },
  );

  it('an explicit grant (rank or member) makes an officer', async () => {
    queue([member(2, 1)], [{ id: 9 }]);
    expect(await adapter.resolveLadder(actor('member'), GUILD)).toBe('officer');
  });

  it('a delegated member row is an officer (grant keyed by member id)', async () => {
    queue([member(3, 4)], [{ id: 10 }]);
    expect(await adapter.resolveLadder(actor('member'), GUILD)).toBe('officer');
  });

  it('a rank-less member row is still checked for a member grant', async () => {
    queue([member(5, null)], [{ id: 11 }]);
    expect(await adapter.resolveLadder(actor('member'), GUILD)).toBe('officer');
  });

  it('a live member without a grant — the GM included — is a member', async () => {
    queue([member(1, 0)], []);
    expect(await adapter.resolveLadder(actor('member'), GUILD)).toBe('member');
  });

  it('a plain member without a grant is a member, not an officer', async () => {
    queue([member(4, 3)], []);
    expect(await adapter.resolveLadder(actor('member'), GUILD)).toBe('member');
  });

  it('no live linked row is a visitor and skips the delegation lookup', async () => {
    db.where.mockResolvedValueOnce([]);
    expect(await adapter.resolveLadder(actor('member'), GUILD)).toBe('visitor');
    expect(db.where).toHaveBeenCalledTimes(1);
  });
});

describe('WowHubKindAdapter membership', () => {
  it('a non-member or soft-removed member (no live row) is not a member', async () => {
    db.where.mockResolvedValue([]);
    expect(await adapter.isMember(42, GUILD)).toBe(false);
    expect(await adapter.memberGroupIds(42)).toEqual([]);
  });

  it('is a member of each distinct guild a linked row names', async () => {
    db.where.mockResolvedValueOnce([member(1, 0), member(2, 5)]);
    expect(await adapter.memberGroupIds(42)).toEqual([GUILD]);
  });
});

describe('GM_RANK_IMPLIES_EDIT', () => {
  it('is off until character ownership is verified', () => {
    expect(GM_RANK_IMPLIES_EDIT).toBe(false);
  });
});
