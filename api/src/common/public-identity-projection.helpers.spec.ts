import { UserProfileSchema } from '@raid-ledger/contract';
import type {
  CharacterDto,
  GameActivityResponseDto,
  GameNowPlayingResponseDto,
  PlayersListResponseDto,
  RecentPlayersResponseDto,
  UserProfileResponse,
} from '@raid-ledger/contract';
import {
  projectGameActivity,
  projectNowPlaying,
  projectPlayersList,
  projectRecentPlayers,
  projectUserProfile,
  toPublicIdentity,
} from './public-identity-projection.helpers';
import { at } from './testing/narrow';

const SNOWFLAKE = '123456789012345678';
const CDN = `https://cdn.discordapp.com/avatars/${SNOWFLAKE}/hash1.png`;
const CUSTOM = 'https://example.com/custom.png';
const FORBIDDEN = [
  'discordId',
  'discordUserId',
  'discordAvatarHash',
  'steamId',
];

/** Every key at any depth (objects + arrays). */
function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, into));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}

function expectNoIdentityKeys(body: unknown): void {
  const keys = [...collectKeys(body)];
  expect(keys.filter((k) => FORBIDDEN.includes(k))).toEqual([]);
}

const linked = {
  discordId: SNOWFLAKE,
  avatar: 'hash1',
  customAvatarUrl: CUSTOM,
};
const local = {
  discordId: 'local:bob',
  avatar: 'hash2',
  customAvatarUrl: null,
};
const unlinked = {
  discordId: 'unlinked:al',
  avatar: 'hash3',
  customAvatarUrl: null,
};

function playersList(): PlayersListResponseDto {
  return {
    data: [
      { id: 1, username: 'linked', steamLinked: true, ...linked },
      { id: 2, username: 'local', steamLinked: false, ...local },
      { id: 3, username: 'unlinked', steamLinked: false, ...unlinked },
    ],
    meta: { total: 3, page: 1, limit: 20, hasMore: false },
  };
}

function recent(): RecentPlayersResponseDto {
  const createdAt = '2026-10-01T00:00:00.000Z';
  return { data: [{ id: 1, username: 'linked', createdAt, ...linked }] };
}

function profile(characters: CharacterDto[] = []): UserProfileResponse {
  return {
    data: {
      id: 1,
      username: 'linked',
      steamLinked: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      characters,
      ...linked,
    },
  };
}

function activity(): GameActivityResponseDto {
  return {
    topPlayers: [
      { userId: 1, username: 'linked', totalSeconds: 60, ...linked },
      { userId: 2, username: 'local', totalSeconds: 30, ...local },
    ],
    totalSeconds: 90,
    period: 'week',
  };
}

function nowPlaying(): GameNowPlayingResponseDto {
  return { players: [{ userId: 1, username: 'linked', ...linked }], count: 1 };
}

describe('toPublicIdentity (ROK-1734, tightened by ROK-1827)', () => {
  it('drops discordId AND the avatar hash for a linked user — no CDN URL', () => {
    expect(toPublicIdentity({ id: 1, ...linked })).toEqual({
      id: 1,
      avatar: null,
      customAvatarUrl: CUSTOM,
    });
  });

  it('nulls the avatar for local: / unlinked: ids and a null hash', () => {
    expect(toPublicIdentity(local).avatar).toBeNull();
    expect(toPublicIdentity(unlinked).avatar).toBeNull();
    expect(
      toPublicIdentity({ discordId: SNOWFLAKE, avatar: null }).avatar,
    ).toBeNull();
  });

  it('passes an absolute avatar URL through (a custom upload has no id)', () => {
    expect(toPublicIdentity({ discordId: null, avatar: CUSTOM }).avatar).toBe(
      CUSTOM,
    );
    expect(toPublicIdentity({ discordId: SNOWFLAKE, avatar: CUSTOM }).avatar).toBe(
      CUSTOM,
    );
  });
});

const cases = [
  ['projectPlayersList', () => projectPlayersList(playersList(), false)],
  ['projectRecentPlayers', () => projectRecentPlayers(recent(), false)],
  ['projectUserProfile', () => projectUserProfile(profile(), false)],
  ['projectGameActivity', () => projectGameActivity(activity(), false)],
  ['projectNowPlaying', () => projectNowPlaying(nowPlaying(), false)],
] as const;

describe.each(cases)('%s — anonymous viewer', (_name, run) => {
  it('carries no Discord / Steam identity key at any depth', () => {
    expectNoIdentityKeys(run());
  });

  it('sends the linked user no avatar at all, but keeps customAvatarUrl (ROK-1827)', () => {
    const body = JSON.stringify(run());
    expect(body).toContain('"avatar":null');
    expect(body).toContain(`"customAvatarUrl":"${CUSTOM}"`);
    expect(body).not.toContain('"avatar":"hash1"');
    expect(body).not.toContain(CDN);
    expect(body).not.toContain('cdn.discordapp.com/avatars');
  });

  it('carries the Discord snowflake nowhere in the serialised body (ROK-1827)', () => {
    expect(JSON.stringify(run())).not.toContain(SNOWFLAKE);
  });
});

describe('member viewer keeps today’s payload (same reference)', () => {
  it.each([
    ['players', playersList(), projectPlayersList],
    ['recent', recent(), projectRecentPlayers],
    ['profile', profile(), projectUserProfile],
    ['activity', activity(), projectGameActivity],
    ['nowPlaying', nowPlaying(), projectNowPlaying],
  ] as const)('%s', (_name, payload, project) => {
    const out = (project as (p: unknown, m: boolean) => unknown)(payload, true);
    expect(out).toBe(payload);
    expect(JSON.stringify(out)).toContain(`"discordId":"${SNOWFLAKE}"`);
  });
});

describe('anonymous shapes', () => {
  it('keep steamLinked and the list meta on /users', () => {
    const out = projectPlayersList(playersList(), false);
    expect(out.data.map((u) => u.steamLinked)).toEqual([true, false, false]);
    expect(out.meta).toEqual(playersList().meta);
  });

  it('keep steamLinked on the profile (Q3)', () => {
    const out = projectUserProfile(profile(), false);
    expect(out.data.steamLinked).toBe(true);
  });

  it('every user gets a null avatar on /users — linked included (ROK-1827)', () => {
    const out = projectPlayersList(playersList(), false);
    expect(out.data.map((u) => u.avatar)).toEqual([null, null, null]);
  });
});

describe('strict parse — a new key throws instead of leaking (AC4)', () => {
  it('rejects an unknown key on a /users row', () => {
    const p = playersList();
    Object.assign(at(p.data, 0), { steamId: '7656119' });
    expect(() => projectPlayersList(p, false)).toThrow(/steamId/);
  });

  it('rejects steamId injected into the profile', () => {
    const p = profile();
    Object.assign(p.data, { steamId: '7656119' });
    expect(() => projectUserProfile(p, false)).toThrow(/steamId/);
  });

  it('rejects an unknown key on activity and now-playing rows', () => {
    const a = activity();
    Object.assign(at(a.topPlayers, 0), { discordUserId: SNOWFLAKE });
    expect(() => projectGameActivity(a, false)).toThrow(/discordUserId/);
    const n = nowPlaying();
    Object.assign(at(n.players, 0), { email: 'x@y.z' });
    expect(() => projectNowPlaying(n, false)).toThrow(/email/);
  });

  it('rejects an unknown key on a recent-player row and on a profile character', () => {
    const r = recent();
    Object.assign(at(r.data, 0), { discordAvatarHash: 'h' });
    expect(() => projectRecentPlayers(r, false)).toThrow(/discordAvatarHash/);
    const char = { id: 'c1', name: 'Thrall', ownerDiscordId: SNOWFLAKE };
    const p = profile([char as unknown as CharacterDto]);
    expect(() => projectUserProfile(p, false)).toThrow(/ownerDiscordId/);
  });

  it('checks profile character values loosely (a non-RFC uuid does not 500)', () => {
    const char = { id: 'not-a-uuid', name: 'Thrall', avatarUrl: 'not-a-url' };
    const out = projectUserProfile(
      profile([char as unknown as CharacterDto]),
      false,
    );
    expect(out.data.characters).toEqual([char]);
  });
});

describe('member profile schema (Q1: steamId is owner-only)', () => {
  it('has no steamId key, so it cannot be serialised silently', () => {
    expect(Object.keys(UserProfileSchema.shape)).not.toContain('steamId');
  });
});
