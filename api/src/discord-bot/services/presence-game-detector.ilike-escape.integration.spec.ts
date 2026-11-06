/**
 * Backlog 2026-10-18 (presence-game-detector.service.ts:312): a Discord
 * activity name was used verbatim as an ILIKE pattern, so a Rich Presence or
 * '/playing' name of '%' (or one '_' per character) resolved to an arbitrary
 * game and attributed Quick Play to it. LIKE metacharacters must now match
 * only themselves, while a case-insensitive exact name still resolves.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { PresenceGameDetectorService } from './presence-game-detector.service';

let testApp: TestApp;
let detector: PresenceGameDetectorService;

beforeAll(async () => {
  testApp = await getTestApp();
  detector = testApp.app.get(PresenceGameDetectorService);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('PresenceGameDetectorService.resolveGame — ILIKE escaping', () => {
  it("does not resolve '%' to the seeded game", async () => {
    const result = await detector.resolveGame('%');

    expect(result).toEqual({ gameId: null, gameName: '%' });
  });

  it("does not resolve one '_' per character to the seeded game", async () => {
    const underscores = '_'.repeat(testApp.seed.game.name.length);

    const result = await detector.resolveGame(underscores);

    expect(result).toEqual({ gameId: null, gameName: underscores });
  });

  it('still resolves the seeded game by a different-case exact name', async () => {
    const { game } = testApp.seed;

    const result = await detector.resolveGame(game.name.toUpperCase());

    expect(result).toEqual({ gameId: game.id, gameName: game.name });
  });
});
