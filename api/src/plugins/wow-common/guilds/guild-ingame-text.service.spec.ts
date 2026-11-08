/**
 * ROK-2137 review r2 — Adopt reads and checks the in-game report inside the
 * save's transaction, after `lockIngameText` took the row lock, so an import
 * landing between the check and the write makes Adopt a 409 instead of
 * writing the old report.
 */
import { ConflictException } from '@nestjs/common';
import type { GuildAccessService } from '../../../guilds/guild-access.service';
import { findGuildKind } from '../../../guilds/guild-core.queries';
import type { GameTextRow } from './guild-ingame-game-text.helpers';
import { findGameText } from './guild-ingame-game-text.queries';
import {
  findIngameText,
  lockIngameText,
  writeIngameText,
  type Db,
} from './guild-ingame-text.queries';
import { GuildIngameTextService } from './guild-ingame-text.service';

jest.mock('../../../guilds/guild-core.queries');
jest.mock('./guild-ingame-game-text.queries');
jest.mock('./guild-ingame-text.queries');

const REPORTED = '2026-11-08T21:00:00.000000Z';
const actor = { id: 7, role: 'member' as const };
const tx = { kind: 'tx' };
const db = {
  kind: 'db',
  transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
    fn(tx),
  ),
};
const access = {
  canView: jest.fn(() => Promise.resolve(true)),
  canEdit: jest.fn(() => Promise.resolve(true)),
};

function gameRow(motdReportedAt: string | null): GameTextRow {
  return {
    motd: 'Raid at 9',
    motdReportedAt,
    motdReportedBy: 'Thrall',
    motdAcked: false,
    info: null,
    infoReportedAt: null,
    infoReportedBy: null,
    infoAcked: false,
  };
}

const service = new GuildIngameTextService(
  db as unknown as Db,
  access as unknown as GuildAccessService,
);
const adopt = (gameReportedAt: string) =>
  service.adopt(actor, 1, 'motd', { baseUpdatedAt: null, gameReportedAt });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(findGuildKind).mockResolvedValue('wow_guild');
  jest.mocked(findIngameText).mockResolvedValue(null);
  jest.mocked(lockIngameText).mockResolvedValue({
    motd: { text: null, updatedAt: null },
    info: { text: null, updatedAt: null },
  });
  jest.mocked(findGameText).mockResolvedValue(gameRow(REPORTED));
});

describe('GuildIngameTextService.adopt — review r2', () => {
  it('reads the report with the transaction, after the row lock, and writes with it', async () => {
    await adopt(REPORTED);
    const read = jest.mocked(findGameText).mock;
    expect(read.calls[0]?.[0]).toBe(tx);
    const lockOrder = jest.mocked(lockIngameText).mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(read.invocationCallOrder[0] ?? 0);
    expect(jest.mocked(writeIngameText).mock.calls[0]?.[0]).toBe(tx);
    expect(jest.mocked(writeIngameText).mock.calls[0]?.[2]).toMatchObject({
      ingameMotd: 'Raid at 9',
    });
  });

  it('a report that moved under the lock is a 409 and writes nothing', async () => {
    jest
      .mocked(findGameText)
      .mockResolvedValue(gameRow('2026-11-08T21:00:00.001000Z'));
    await expect(adopt(REPORTED)).rejects.toBeInstanceOf(ConflictException);
    expect(jest.mocked(findGameText).mock.calls[0]?.[0]).toBe(tx);
    expect(writeIngameText).not.toHaveBeenCalled();
  });

  it('a field never reported is a 409 NO_GAME_REPORT and writes nothing', async () => {
    jest.mocked(findGameText).mockResolvedValue(gameRow(null));
    await expect(adopt(REPORTED)).rejects.toMatchObject({
      response: { code: 'NO_GAME_REPORT' },
    });
    expect(writeIngameText).not.toHaveBeenCalled();
  });
});
