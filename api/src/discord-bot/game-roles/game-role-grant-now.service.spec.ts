/**
 * ROK-1767 — grantNow's existing-grant gate. A grant row alone must not
 * suppress the add: when the member's role was removed by hand (or they left
 * and rejoined) the cached member no longer carries it and the role is
 * restored. The check reads the gateway member cache — no extra REST call.
 */
import { Collection, type Guild, type GuildMember } from 'discord.js';
import type { CronJobService } from '../../cron-jobs/cron-job.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import * as discord from './game-role-discord.helpers';
import * as helpers from './game-role-reconcile.helpers';
import { GameRoleReconcileService } from './game-role-reconcile.service';

const ROLE = 'role-x';
const DISCORD_ID = '9100';

function guildWith(cached: string[] | null): Guild {
  const cache = new Collection<string, GuildMember>();
  if (cached) {
    const roles = { cache: new Collection(cached.map((r) => [r, {}])) };
    cache.set(DISCORD_ID, { roles } as unknown as GuildMember);
  }
  return { id: 'g', members: { cache } } as unknown as Guild;
}

function service(guild: Guild): GameRoleReconcileService {
  const bot = { getGuild: () => guild } as unknown as DiscordBotClientService;
  return new GameRoleReconcileService(
    {} as helpers.GameRoleDb,
    {} as CronJobService,
    bot,
  );
}

const spies = {
  load: jest.spyOn(helpers, 'loadEnabledGameRoles'),
  candidate: jest.spyOn(helpers, 'loadGrantCandidate'),
  upsert: jest.spyOn(helpers, 'upsertGrant'),
  deleteGrant: jest.spyOn(helpers, 'deleteGrant'),
  audit: jest.spyOn(helpers, 'writeAudit'),
  holds: jest.spyOn(discord, 'memberHoldsRole'),
  add: jest.spyOn(discord, 'addMemberRole'),
  remove: jest.spyOn(discord, 'removeMemberRole'),
};

beforeEach(() => {
  jest.clearAllMocks();
  spies.load.mockResolvedValue([
    { id: 3, gameId: 7, roleId: ROLE } as helpers.GameRoleRow,
  ] as never);
  spies.candidate.mockResolvedValue({
    discordId: DISCORD_ID,
    grantedTo: DISCORD_ID,
  });
  spies.upsert.mockResolvedValue(undefined);
  spies.deleteGrant.mockResolvedValue(undefined);
  spies.remove.mockResolvedValue(true);
  spies.audit.mockResolvedValue(undefined);
  spies.holds.mockResolvedValue(false);
  spies.add.mockResolvedValue(true);
});

afterAll(() => jest.restoreAllMocks());

describe('GameRoleReconcileService.grantNow with an existing grant', () => {
  it('restores the role when the cached member no longer holds it', async () => {
    const granted = await service(guildWith(['other-role'])).grantNow(1, 7);
    expect({ granted, addCalls: spies.add.mock.calls.length }).toEqual({
      granted: true,
      addCalls: 1,
    });
  });

  it('skips with no Discord call while the cached member still holds it', async () => {
    const granted = await service(guildWith([ROLE])).grantNow(1, 7);
    expect(granted).toBe(false);
    expect(spies.holds).not.toHaveBeenCalled();
    expect(spies.add).not.toHaveBeenCalled();
  });

  it('skips with no Discord call when the member is not cached', async () => {
    const granted = await service(guildWith(null)).grantNow(1, 7);
    expect(granted).toBe(false);
    expect(spies.holds).not.toHaveBeenCalled();
  });
});

describe('GameRoleReconcileService.grantNow after a Discord relink', () => {
  const OLD_ID = '8800';
  beforeEach(() =>
    spies.candidate.mockResolvedValue({
      discordId: DISCORD_ID,
      grantedTo: OLD_ID,
    }),
  );

  it('takes the role off the OLD account, audits it, then grants the new one', async () => {
    // The new account's cached member already "holds" a role of that id in
    // the cache check — the relink must not be suppressed by it.
    const granted = await service(guildWith([ROLE])).grantNow(1, 7);
    expect({
      granted,
      removed: spies.remove.mock.calls.map((c) => c[1]),
      added: spies.add.mock.calls.map((c) => c[1]),
      upserted: spies.upsert.mock.calls.map((c) => c[3]),
      // Only the OLD account's grant row: an overlapping grantNow may already
      // have written the new account's row, which this delete must not drop.
      deleted: spies.deleteGrant.mock.calls.map((c) => c.slice(1)),
      audits: spies.audit.mock.calls.map((c) => [
        c[1].action,
        c[1].discordUserId,
        c[1].reason.startsWith('played') ? 'played' : c[1].reason,
      ]),
    }).toEqual({
      granted: true,
      removed: [OLD_ID],
      added: [DISCORD_ID],
      upserted: [DISCORD_ID],
      deleted: [[3, 1, OLD_ID]],
      audits: [
        ['role_removed', OLD_ID, 'discord account relinked'],
        ['role_added', DISCORD_ID, 'played'],
      ],
    });
  });

  it('a failed removal on the old account is best-effort: the new grant still lands', async () => {
    spies.remove.mockRejectedValue(new Error('Missing Permissions'));
    const granted = await service(guildWith(null)).grantNow(1, 7);
    expect({ granted, added: spies.add.mock.calls.length }).toEqual({
      granted: true,
      added: 1,
    });
  });
});
