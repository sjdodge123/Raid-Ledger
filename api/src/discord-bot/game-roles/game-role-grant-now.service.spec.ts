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
  audit: jest.spyOn(helpers, 'writeAudit'),
  holds: jest.spyOn(discord, 'memberHoldsRole'),
  add: jest.spyOn(discord, 'addMemberRole'),
};

beforeEach(() => {
  jest.clearAllMocks();
  spies.load.mockResolvedValue([
    { id: 3, gameId: 7, roleId: ROLE } as helpers.GameRoleRow,
  ] as never);
  spies.candidate.mockResolvedValue({ discordId: DISCORD_ID, granted: true });
  spies.upsert.mockResolvedValue(undefined);
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
