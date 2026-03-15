/**
 * Unit tests for event-response-embed.helpers.ts (ROK-825).
 *
 * Tests the data transformation in buildEmbedEventData:
 * - Inactive status filtering (declined, roached_out, departed)
 * - signupCount based on active-only rows
 * - signupMentions mapping (role, className, preferredRoles, status)
 * - roleCounts passthrough from DB query
 * - game field mapping
 * - Event metadata passthrough (id, title, description, startTime, endTime)
 *
 * The DB is mocked at the query boundary using chainable select mocks.
 * No Drizzle internals are tested — only the transformation logic.
 */
import { buildEmbedEventData } from './event-response-embed.helpers';
import type { EventResponseDto } from '@raid-ledger/contract';

// ─── Mock helpers ─────────────────────────────────────────────────────────

/** Build a thenable chainable select mock that resolves with the given rows. */
function makeSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.leftJoin = jest.fn().mockReturnValue(chain);
  chain.groupBy = jest.fn().mockResolvedValue(rows);
  // Thenable so `.where()` chain can be awaited directly
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

/** Build a minimal DB mock that returns role-count rows first, then signup rows. */
function makeMockDb(
  roleCountRows: unknown[],
  signupRows: unknown[],
): Record<string, jest.Mock> {
  const roleCountChain = makeSelectChain(roleCountRows);
  const signupChain = makeSelectChain(signupRows);
  let callCount = 0;
  const selectFn = jest.fn().mockImplementation(() => {
    callCount++;
    // queryRoleCounts uses groupBy as terminal; querySignupRows uses where as terminal.
    // Both are called via Promise.all — we alternate responses by call order.
    return callCount === 1 ? roleCountChain : signupChain;
  });
  return { select: selectFn };
}

/** Minimal EventResponseDto fixture. */
function makeEventDto(
  overrides: Partial<EventResponseDto> = {},
): EventResponseDto {
  return {
    id: 1,
    title: 'Test Raid',
    description: 'A test event',
    startTime: '2026-05-01T18:00:00.000Z',
    endTime: '2026-05-01T21:00:00.000Z',
    maxAttendees: null,
    slotConfig: null,
    game: null,
    ...overrides,
  } as EventResponseDto;
}

// ─── signupCount ─────────────────────────────────────────────────────────

describe('buildEmbedEventData — signupCount', () => {
  it('counts only active signups (excludes declined)', async () => {
    const db = makeMockDb(
      [],
      [
        {
          discordId: 'u1',
          username: 'alice',
          role: 'tank',
          status: 'signed_up',
          preferredRoles: ['tank'],
          className: null,
        },
        {
          discordId: 'u2',
          username: 'bob',
          role: null,
          status: 'declined',
          preferredRoles: null,
          className: null,
        },
      ],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.signupCount).toBe(1);
  });

  it('counts only active signups (excludes roached_out)', async () => {
    const db = makeMockDb(
      [],
      [
        {
          discordId: 'u1',
          username: 'alice',
          role: null,
          status: 'roached_out',
          preferredRoles: null,
          className: null,
        },
        {
          discordId: 'u2',
          username: 'bob',
          role: 'healer',
          status: 'signed_up',
          preferredRoles: ['healer'],
          className: null,
        },
      ],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.signupCount).toBe(1);
  });

  it('counts only active signups (excludes departed)', async () => {
    const db = makeMockDb(
      [],
      [
        {
          discordId: 'u1',
          username: 'alice',
          role: null,
          status: 'departed',
          preferredRoles: null,
          className: null,
        },
      ],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.signupCount).toBe(0);
  });

  it('counts all active signups with different statuses', async () => {
    const db = makeMockDb(
      [],
      [
        {
          discordId: 'u1',
          username: 'alice',
          role: 'tank',
          status: 'signed_up',
          preferredRoles: ['tank'],
          className: null,
        },
        {
          discordId: 'u2',
          username: 'bob',
          role: null,
          status: 'tentative',
          preferredRoles: ['dps'],
          className: null,
        },
        {
          discordId: 'u3',
          username: 'charlie',
          role: 'dps',
          status: 'confirmed',
          preferredRoles: ['dps'],
          className: null,
        },
      ],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.signupCount).toBe(3);
  });

  it('returns 0 when no signups exist', async () => {
    const db = makeMockDb([], []);
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.signupCount).toBe(0);
  });
});

// ─── signupMentions ───────────────────────────────────────────────────────

describe('buildEmbedEventData — signupMentions filtering', () => {
  it('excludes declined users from signupMentions', async () => {
    const db = makeMockDb(
      [],
      [
        {
          discordId: 'u1',
          username: 'alice',
          role: 'tank',
          status: 'signed_up',
          preferredRoles: ['tank'],
          className: null,
        },
        {
          discordId: 'u2',
          username: 'bob',
          role: null,
          status: 'declined',
          preferredRoles: null,
          className: null,
        },
      ],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.signupMentions).toHaveLength(1);
    expect(result.signupMentions![0].username).toBe('alice');
  });

  it('excludes rows with no discordId and no username', async () => {
    const db = makeMockDb(
      [],
      [
        {
          discordId: null,
          username: null,
          role: 'dps',
          status: 'signed_up',
          preferredRoles: null,
          className: null,
        },
        {
          discordId: 'u1',
          username: 'alice',
          role: 'tank',
          status: 'signed_up',
          preferredRoles: ['tank'],
          className: null,
        },
      ],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.signupMentions).toHaveLength(1);
    expect(result.signupMentions![0].discordId).toBe('u1');
  });

  it('maps role correctly for assigned user', async () => {
    const db = makeMockDb(
      [],
      [
        {
          discordId: 'u1',
          username: 'alice',
          role: 'healer',
          status: 'signed_up',
          preferredRoles: ['healer'],
          className: 'Paladin',
        },
      ],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    const mention = result.signupMentions![0];
    expect(mention.role).toBe('healer');
    expect(mention.className).toBe('Paladin');
    expect(mention.preferredRoles).toEqual(['healer']);
    expect(mention.status).toBe('signed_up');
  });

  it('maps role as null when user has no roster assignment', async () => {
    const db = makeMockDb(
      [],
      [
        {
          discordId: 'u1',
          username: 'alice',
          role: null,
          status: 'signed_up',
          preferredRoles: ['dps'],
          className: null,
        },
      ],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.signupMentions![0].role).toBeNull();
  });

  it('maps className as null when no character linked', async () => {
    const db = makeMockDb(
      [],
      [
        {
          discordId: 'u1',
          username: 'alice',
          role: 'dps',
          status: 'signed_up',
          preferredRoles: ['dps'],
          className: null,
        },
      ],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.signupMentions![0].className).toBeNull();
  });
});

// ─── roleCounts passthrough ───────────────────────────────────────────────

describe('buildEmbedEventData — roleCounts', () => {
  it('passes through role counts from DB query', async () => {
    const db = makeMockDb(
      [
        { role: 'tank', count: 2 },
        { role: 'healer', count: 1 },
        { role: 'dps', count: 5 },
      ],
      [],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.roleCounts).toMatchObject({
      tank: 2,
      healer: 1,
      dps: 5,
    });
  });

  it('returns empty roleCounts when no assignments exist', async () => {
    const db = makeMockDb([], []);
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.roleCounts).toEqual({});
  });

  it('omits null roles from roleCounts', async () => {
    const db = makeMockDb(
      [
        { role: null, count: 3 },
        { role: 'tank', count: 1 },
      ],
      [],
    );
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.roleCounts).toEqual({ tank: 1 });
    expect(result.roleCounts).not.toHaveProperty('null');
  });
});

// ─── Event metadata passthrough ───────────────────────────────────────────

describe('buildEmbedEventData — event metadata', () => {
  it('passes through event id, title, description, startTime, endTime', async () => {
    const db = makeMockDb([], []);
    const dto = makeEventDto({
      id: 42,
      title: 'Epic Raid',
      description: 'Big boss night',
      startTime: '2026-06-01T20:00:00.000Z',
      endTime: '2026-06-01T23:00:00.000Z',
    });
    const result = await buildEmbedEventData(db as never, dto, 42);
    expect(result.id).toBe(42);
    expect(result.title).toBe('Epic Raid');
    expect(result.description).toBe('Big boss night');
    expect(result.startTime).toBe('2026-06-01T20:00:00.000Z');
    expect(result.endTime).toBe('2026-06-01T23:00:00.000Z');
  });

  it('passes through maxAttendees as null when not set', async () => {
    const db = makeMockDb([], []);
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.maxAttendees).toBeNull();
  });

  it('passes through maxAttendees when set', async () => {
    const db = makeMockDb([], []);
    const dto = makeEventDto({ maxAttendees: 25 });
    const result = await buildEmbedEventData(db as never, dto, 1);
    expect(result.maxAttendees).toBe(25);
  });
});

// ─── game field ────────────────────────────────────────────────────────────

describe('buildEmbedEventData — game field', () => {
  it('maps game name and coverUrl when game is present', async () => {
    const db = makeMockDb([], []);
    const dto = makeEventDto({
      game: {
        id: 1,
        name: 'World of Warcraft',
        coverUrl: 'https://img.example.com/wow.jpg',
        slug: 'world-of-warcraft',
        hasRoles: true,
        hasSpecs: false,
      },
    } as never);
    const result = await buildEmbedEventData(db as never, dto, 1);
    expect(result.game).toMatchObject({
      name: 'World of Warcraft',
      coverUrl: 'https://img.example.com/wow.jpg',
    });
  });

  it('sets game to null when event has no game', async () => {
    const db = makeMockDb([], []);
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.game).toBeNull();
  });
});

// ─── slotConfig passthrough ────────────────────────────────────────────────

describe('buildEmbedEventData — slotConfig', () => {
  it('passes through slotConfig when present', async () => {
    const db = makeMockDb([], []);
    const slotConfig = { type: 'mmo', tank: 1, healer: 1, dps: 3 };
    const dto = makeEventDto({ slotConfig: slotConfig as never });
    const result = await buildEmbedEventData(db as never, dto, 1);
    expect(result.slotConfig).toMatchObject({
      type: 'mmo',
      tank: 1,
      healer: 1,
      dps: 3,
    });
  });

  it('sets slotConfig to null when not present', async () => {
    const db = makeMockDb([], []);
    const result = await buildEmbedEventData(db as never, makeEventDto(), 1);
    expect(result.slotConfig).toBeNull();
  });
});
