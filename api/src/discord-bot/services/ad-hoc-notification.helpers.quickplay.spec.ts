/**
 * ROK-1447 — TDD pins for the widened Quick Play game projection.
 *
 * The compact embed shows a sale badge and a co-op badge, so the columns that
 * decide them have to travel with the game. Two things are pinned here:
 *
 *   1. `resolveGame` SELECTS the badge columns — the projection itself, not
 *      just the shape of what happens to come back from the mock. A widened
 *      return type with a narrow `select` would silently return `undefined`
 *      for every badge column against a real DB.
 *   2. `buildEmbedEventData` carries `game.id` (ROK-1460) plus a `game.badges`
 *      sub-object holding those columns verbatim, so `buildQuickPlayEmbed` can
 *      hand them straight to `coopBadge` / `priceBadge`.
 *
 * The scheduled-event path is deliberately untouched: `badges` is OPTIONAL, so
 * the other four hydration sites keep producing byte-identical embeds (AC7).
 *
 * Sibling `ad-hoc-notification.helpers.adversarial.spec.ts:174-188` pins `game`
 * with a strict `toEqual({ name, coverUrl })`; the dev rewrites that pin to the
 * new shape as part of this story (spec §Files, AC8).
 */
import { buildEmbedEventData } from './ad-hoc-notification.helpers';
import type { AdHocNotificationDeps } from './ad-hoc-notification.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

/** Every column the badge helpers read, plus the three ROK-1460 already had. */
const REQUIRED_GAME_COLUMNS = [
  'id',
  'name',
  'coverUrl',
  'isFreeToPlay',
  'itadCurrentPrice',
  'itadCurrentCut',
  'itadCurrentShop',
  'itadCurrentUrl',
  'itadLowestPrice',
  'itadPriceUpdatedAt',
  'cooptimusOnlineMax',
  'cooptimusCouchMax',
  'cooptimusComboCoop',
] as const;

const PRICE_CHECKED_AT = new Date('2026-09-01T09:00:00Z');

function createMockDeps(mockDb: MockDb): AdHocNotificationDeps {
  return {
    db: mockDb as unknown as AdHocNotificationDeps['db'],
    channelBindingsService: {
      getBindingById: jest.fn(),
      getBindings: jest.fn().mockResolvedValue([]),
    } as unknown as AdHocNotificationDeps['channelBindingsService'],
    channelResolver: {
      resolveVoiceChannelHonoringOverride: jest.fn().mockResolvedValue(null),
    } as unknown as AdHocNotificationDeps['channelResolver'],
    settingsService: {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
      getClientUrl: jest.fn().mockResolvedValue('http://localhost'),
      getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
      getDiscordBotDefaultChannel: jest.fn().mockResolvedValue('default-ch'),
    } as unknown as AdHocNotificationDeps['settingsService'],
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'World of Warcraft — Quick Play',
    gameId: 10,
    duration: [
      new Date('2026-09-02T18:00:00Z'),
      new Date('2026-09-02T20:00:00Z'),
    ],
    extendedUntil: null,
    maxAttendees: null,
    slotConfig: null,
    notificationChannelOverride: null,
    recurrenceGroupId: null,
    ephemeralVoiceChannelId: null,
    ...overrides,
  };
}

/** A games row carrying a live deal and an online co-op claim. */
function makeGameRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: 'World of Warcraft',
    coverUrl: 'https://cdn.example/wow.jpg',
    isFreeToPlay: false,
    itadCurrentPrice: '29.99',
    itadCurrentCut: 50,
    itadCurrentShop: 'Steam',
    itadCurrentUrl: 'https://store.example/deal',
    itadLowestPrice: '14.99',
    itadPriceUpdatedAt: PRICE_CHECKED_AT,
    cooptimusOnlineMax: 4,
    cooptimusCouchMax: 2,
    cooptimusComboCoop: true,
    ...overrides,
  };
}

function mockEventAndGame(
  mockDb: MockDb,
  eventOverrides: Record<string, unknown> = {},
  gameRow: Record<string, unknown> | null = makeGameRow(),
): void {
  mockDb.limit.mockResolvedValueOnce([makeEvent(eventOverrides)]);
  mockDb.limit.mockResolvedValueOnce(gameRow ? [gameRow] : []);
}

/** The column map handed to the `select()` that reads the games row. */
function selectedGameColumns(mockDb: MockDb): Record<string, unknown> {
  const withArgs = mockDb.select.mock.calls.filter(
    (call: unknown[]) => call[0] !== undefined,
  );
  expect(withArgs.length).toBeGreaterThan(0);
  return withArgs[withArgs.length - 1][0] as Record<string, unknown>;
}

describe('resolveGame — the projection carries the badge columns (ROK-1447)', () => {
  let mockDb: MockDb;
  let deps: AdHocNotificationDeps;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    deps = createMockDeps(mockDb);
  });

  it.each(REQUIRED_GAME_COLUMNS)('selects the `%s` column', async (column) => {
    mockEventAndGame(mockDb);
    await buildEmbedEventData(deps, 1, []);
    expect(Object.keys(selectedGameColumns(mockDb))).toContain(column);
  });

  it('selects a bounded column map, not the whole games row', async () => {
    // `select()` with no argument would drag ~40 columns (including the raw
    // IGDB blobs) into every 5s embed re-sync.
    mockEventAndGame(mockDb);
    await buildEmbedEventData(deps, 1, []);
    expect(Object.keys(selectedGameColumns(mockDb)).length).toBeLessThanOrEqual(
      REQUIRED_GAME_COLUMNS.length,
    );
  });
});

describe('buildEmbedEventData — game.badges (ROK-1447)', () => {
  let mockDb: MockDb;
  let deps: AdHocNotificationDeps;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    deps = createMockDeps(mockDb);
  });

  it('keeps carrying the id, name and cover the title and art need', async () => {
    mockEventAndGame(mockDb);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.game).toMatchObject({
      id: 10,
      name: 'World of Warcraft',
      coverUrl: 'https://cdn.example/wow.jpg',
    });
  });

  it('hands the badge columns through verbatim under `badges`', async () => {
    mockEventAndGame(mockDb);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.game!.badges).toEqual({
      isFreeToPlay: false,
      itadCurrentPrice: '29.99',
      itadCurrentCut: 50,
      itadCurrentShop: 'Steam',
      itadCurrentUrl: 'https://store.example/deal',
      itadLowestPrice: '14.99',
      itadPriceUpdatedAt: PRICE_CHECKED_AT,
      cooptimusOnlineMax: 4,
      cooptimusCouchMax: 2,
      cooptimusComboCoop: true,
    });
  });

  it('preserves the ITAD prices as the numeric-as-string columns they are', async () => {
    // `numeric` comes back from postgres.js as a STRING; rounding it to a JS
    // number here would lose the 2dp the badge renders.
    mockEventAndGame(mockDb);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(typeof result!.game!.badges!.itadCurrentPrice).toBe('string');
    expect(typeof result!.game!.badges!.itadLowestPrice).toBe('string');
  });

  it('carries a free-to-play flag through untouched', async () => {
    mockEventAndGame(mockDb, {}, makeGameRow({ isFreeToPlay: true }));
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.game!.badges!.isFreeToPlay).toBe(true);
  });

  it('carries nulls rather than dropping the sub-object for a bare game', async () => {
    mockEventAndGame(
      mockDb,
      {},
      makeGameRow({
        itadCurrentPrice: null,
        itadCurrentCut: null,
        itadCurrentUrl: null,
        itadLowestPrice: null,
        itadPriceUpdatedAt: null,
        cooptimusOnlineMax: null,
        cooptimusCouchMax: null,
        cooptimusComboCoop: null,
      }),
    );
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.game!.badges).toMatchObject({
      itadCurrentCut: null,
      cooptimusOnlineMax: null,
    });
  });

  it('still omits the game entirely for a gameless event', async () => {
    mockDb.limit.mockResolvedValueOnce([makeEvent({ gameId: null })]);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.game).toBeUndefined();
  });

  it('still omits the game when the row has vanished', async () => {
    mockEventAndGame(mockDb, {}, null);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.game).toBeUndefined();
  });
});
