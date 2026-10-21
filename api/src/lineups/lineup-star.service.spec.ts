/**
 * ROK-1428 Codex r10 P2 — a star on a game the voter had not approved inserts
 * a `community_lineup_votes` row (counted by `lineupVoteSignal`), so the star
 * path nudges the channel lifecycle after its transaction commits, exactly
 * like `toggleVote`. Clearing a star adds no activity and does not nudge.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { GameActivityNudge } from '../discord-bot/channel-lifecycle/channel-lifecycle.nudge';
import { LineupStarService } from './lineup-star.service';
import * as voting from './lineups-voting.helpers';
import * as query from './lineups-query.helpers';
import * as response from './lineups-response.helpers';

jest.mock('./lineups-voting.helpers');
jest.mock('./lineups-query.helpers');
jest.mock('./lineups-response.helpers');
jest.mock('./lineups-actions.helpers');
jest.mock('./lineups-eligibility.helpers');

const DB = {} as unknown as PostgresJsDatabase<typeof schema>;
const BOT = { getGuild: () => null } as unknown as DiscordBotClientService;

function makeService(touch: jest.Mock): LineupStarService {
  const nudge = { touch } as unknown as GameActivityNudge;
  return new LineupStarService(DB, BOT, nudge);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(query.findLineupById)
    .mockResolvedValue([
      { id: 1, status: 'voting', maxVotesPerPlayer: 3 },
    ] as never);
  jest.mocked(voting.isGameNominated).mockResolvedValue(true);
  jest.mocked(response.buildDetailResponse).mockResolvedValue({} as never);
});

describe('LineupStarService.setStar — lifecycle nudge (Codex r10 P2)', () => {
  it('a star (implicit approval) nudges the game after the write commits', async () => {
    const touch = jest.fn();
    jest.mocked(voting.setStar).mockResolvedValue('set');
    await makeService(touch).setStar(1, 7, 2);
    expect(touch).toHaveBeenCalledWith(7);
    const written = jest.mocked(voting.setStar).mock.invocationCallOrder[0];
    expect(touch.mock.invocationCallOrder[0]).toBeGreaterThan(written ?? 0);
  });

  it('clearing a star does not nudge', async () => {
    const touch = jest.fn();
    jest.mocked(voting.setStar).mockResolvedValue('cleared');
    await makeService(touch).setStar(1, null, 2);
    expect(touch).not.toHaveBeenCalled();
  });

  it('a nudge that throws never fails the star', async () => {
    const touch = jest.fn(() => {
      throw new Error('queue down');
    });
    jest.mocked(voting.setStar).mockResolvedValue('set');
    await expect(makeService(touch).setStar(1, 7, 2)).resolves.toEqual({});
  });
});
