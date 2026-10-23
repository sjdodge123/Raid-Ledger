/**
 * ROK-1893 P3 (D16): `inheritPollHub` — the hub a poll-locked event inherits.
 */
import type { CreateEventDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { inheritPollHub } from './event-create.helpers';
import {
  findMatchPollHub,
  isLiveHubMemberOrStaff,
} from '../lineups/standalone-poll/standalone-poll-hub.helpers';

jest.mock('../lineups/standalone-poll/standalone-poll-hub.helpers', () => ({
  findMatchPollHub: jest.fn(),
  isLiveHubMemberOrStaff: jest.fn(),
}));

const db = {} as PostgresJsDatabase<typeof schema>;
const hub = { id: 7, name: 'Hub', gameId: 3, memberCount: 2 };
const dto: CreateEventDto = {
  title: 'From poll',
  gameId: 3,
  startTime: '2026-11-01T18:00:00.000Z',
  endTime: '2026-11-01T20:00:00.000Z',
  schedulingMatchId: 11,
};

describe('inheritPollHub', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(findMatchPollHub).mockResolvedValue(hub);
    jest.mocked(isLiveHubMemberOrStaff).mockResolvedValue(true);
  });

  it('tags the event with the poll hub for a live member or staff creator', async () => {
    const out = await inheritPollHub(db, dto, 5);
    expect(out.guildId).toBe(7);
    expect(isLiveHubMemberOrStaff).toHaveBeenCalledWith(db, 7, 5);
  });

  it('does not inherit when the creator is banned / has left (not live, not staff)', async () => {
    jest.mocked(isLiveHubMemberOrStaff).mockResolvedValue(false);
    const out = await inheritPollHub(db, dto, 5);
    expect(out.guildId).toBeUndefined();
  });

  it('keeps an explicit guildId: null (opt-out) and an explicit other guild', async () => {
    expect(
      (await inheritPollHub(db, { ...dto, guildId: null }, 5)).guildId,
    ).toBeNull();
    expect((await inheritPollHub(db, { ...dto, guildId: 9 }, 5)).guildId).toBe(
      9,
    );
    expect(findMatchPollHub).not.toHaveBeenCalled();
  });
});
