/**
 * ROK-2283 — unit: the `/login` sign-in token (mint + consume-first redeem),
 * its claim parser, and the `src:'cmd'` claim on magic links.
 */
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  DiscordSigninLinkService,
  INVALID_DISCORD_LINK_MESSAGE,
} from './discord-signin-link.service';
import {
  isDiscordSnowflake,
  parseDiscordSigninClaims,
} from './discord-signin-link.helpers';
import { MagicLinkService } from './magic-link.service';
import { derivePurposeSecret, signPurposeJwt } from './purpose-jwt.helpers';
import { hashToken } from './single-use-token.helpers';
import { readTokenVersion } from './token-version.helpers';

jest.mock('./token-version.helpers', () => ({
  readTokenVersion: jest.fn().mockResolvedValue(7),
}));

const SECRET = 'signin-spec-secret';
const SNOWFLAKE = '123456789012345678';
const jwt = new JwtService({ secret: SECRET });
const INPUT = {
  discordId: SNOWFLAKE,
  username: 'newbie',
  avatar: 'abc',
  src: 'cmd' as const,
};
const NEW_USER = { id: 41, username: 'newbie', role: 'member' as const };

let db: MockDb;
let validateDiscordUser: jest.Mock;
let findById: jest.Mock;
let signin: DiscordSigninLinkService;
let magic: MagicLinkService;

beforeEach(async () => {
  process.env.JWT_SECRET = SECRET;
  db = createDrizzleMock();
  db.returning.mockResolvedValue([{ id: 1 }]);
  validateDiscordUser = jest.fn().mockResolvedValue(NEW_USER);
  findById = jest.fn();
  const mod = await Test.createTestingModule({
    providers: [
      DiscordSigninLinkService,
      MagicLinkService,
      { provide: JwtService, useValue: jwt },
      { provide: AuthService, useValue: { validateDiscordUser } },
      { provide: UsersService, useValue: { findById } },
      { provide: DrizzleAsyncProvider, useValue: db },
    ],
  }).compile();
  signin = mod.get(DiscordSigninLinkService);
  magic = mod.get(MagicLinkService);
});

function tokenOf(link: string): string {
  const url = new URL(link);
  expect(url.search).toBe('');
  return decodeURIComponent(url.hash.replace(/^#token=/, ''));
}

async function redeemError(token: string): Promise<UnauthorizedException> {
  const err: unknown = await signin.redeem(token).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UnauthorizedException);
  if (!(err instanceof UnauthorizedException)) throw new Error('no 401');
  expect(err.message).toBe(INVALID_DISCORD_LINK_MESSAGE);
  return err;
}

describe('DiscordSigninLinkService.mint', () => {
  it('puts a 15-minute discord-signin token in the /signin-link fragment', () => {
    const link = signin.mint(INPUT, 'https://rl.test');
    expect(link.startsWith('https://rl.test/signin-link#token=')).toBe(true);
    const decoded = jwt.decode<Record<string, unknown>>(tokenOf(link));
    expect(Object.keys(decoded).sort()).toEqual([
      'avatar',
      'discordId',
      'exp',
      'iat',
      'jti',
      'signin',
      'src',
      'username',
    ]);
    expect(decoded).toMatchObject({ discordId: SNOWFLAKE, signin: true });
    expect(Number(decoded.exp) - Number(decoded.iat)).toBe(15 * 60);
  });

  it('is not a magic-link token (purpose secrets differ)', () => {
    const token = tokenOf(signin.mint(INPUT, 'https://rl.test'));
    const magicSecret = derivePurposeSecret(SECRET, 'magic-link');
    expect(() => jwt.verify(token, { secret: magicSecret })).toThrow();
  });
});

describe('DiscordSigninLinkService.redeem', () => {
  it('consumes the token, then signs in through validateDiscordUser', async () => {
    const token = tokenOf(signin.mint(INPUT, 'https://rl.test'));
    await expect(signin.redeem(token)).resolves.toEqual({
      ...NEW_USER,
      tokenVersion: 7,
    });
    expect(db.values).toHaveBeenCalledWith({ tokenHash: hashToken(token) });
    expect(validateDiscordUser).toHaveBeenCalledWith(
      SNOWFLAKE,
      'newbie',
      'abc',
    );
  });

  it('401s a replay without touching the user', async () => {
    const token = tokenOf(signin.mint(INPUT, 'https://rl.test'));
    db.returning.mockResolvedValueOnce([]);
    await redeemError(token);
    expect(validateDiscordUser).not.toHaveBeenCalled();
  });

  it('maps a ban (403) or kick (401) from validateDiscordUser to the generic 401', async () => {
    const token = tokenOf(signin.mint(INPUT, 'https://rl.test'));
    validateDiscordUser.mockRejectedValueOnce(new ForbiddenException('ban'));
    await redeemError(token);
    expect(db.values).toHaveBeenCalledWith({ tokenHash: hashToken(token) });
  });

  it('401s a magic-link-purpose token before consuming it', async () => {
    const forged = signPurposeJwt(
      jwt,
      'magic-link',
      { ...INPUT, signin: true },
      '15m',
    );
    await redeemError(forged);
    expect(db.values).not.toHaveBeenCalled();
  });

  it('401s a discord-signin token missing the src claim', async () => {
    const token = signPurposeJwt(
      jwt,
      'discord-signin',
      {
        discordId: INPUT.discordId,
        username: INPUT.username,
        avatar: INPUT.avatar,
        signin: true,
      },
      '15m',
    );
    await redeemError(token);
    expect(db.values).not.toHaveBeenCalled();
  });
});

describe('DiscordSigninLinkService — unlinked-row links pin the token version', () => {
  const REBIND = { userId: 41, tokenVersion: 7 };

  it('carries uid + tv only when minted for an unlinked row', () => {
    const plain = jwt.decode<Record<string, unknown>>(
      tokenOf(signin.mint(INPUT, 'https://rl.test')),
    );
    expect([plain.uid, plain.tv]).toEqual([undefined, undefined]);
    const pinned = jwt.decode<Record<string, unknown>>(
      tokenOf(signin.mint({ ...INPUT, rebind: REBIND }, 'https://rl.test')),
    );
    expect([pinned.uid, pinned.tv]).toEqual([41, 7]);
  });

  it('redeems while the row is still at the minted version', async () => {
    const token = tokenOf(
      signin.mint({ ...INPUT, rebind: REBIND }, 'https://rl.test'),
    );
    await expect(signin.redeem(token)).resolves.toMatchObject({ id: 41 });
    expect(readTokenVersion).toHaveBeenCalledWith(db, 41);
  });

  it('401s once the row moved on (password/role change) and relinks nothing', async () => {
    const token = tokenOf(
      signin.mint(
        { ...INPUT, rebind: { userId: 41, tokenVersion: 6 } },
        'https://rl.test',
      ),
    );
    await redeemError(token);
    expect(validateDiscordUser).not.toHaveBeenCalled();
  });

  it('401s when the pinned row is gone', async () => {
    jest.mocked(readTokenVersion).mockRejectedValueOnce(new Error('not found'));
    const token = tokenOf(
      signin.mint({ ...INPUT, rebind: REBIND }, 'https://rl.test'),
    );
    await redeemError(token);
    expect(validateDiscordUser).not.toHaveBeenCalled();
  });

  it('401s when the sign-in lands on a different row than the pinned one', async () => {
    validateDiscordUser.mockResolvedValueOnce({ ...NEW_USER, id: 99 });
    const token = tokenOf(
      signin.mint({ ...INPUT, rebind: REBIND }, 'https://rl.test'),
    );
    await redeemError(token);
  });
});

describe('parseDiscordSigninClaims / isDiscordSnowflake', () => {
  const base = { ...INPUT, signin: true, iat: 1 };
  it('accepts well-formed claims (null avatar allowed)', () => {
    expect(parseDiscordSigninClaims({ ...base, avatar: null })).toEqual({
      discordId: SNOWFLAKE,
      username: 'newbie',
      avatar: null,
      rebind: null,
    });
  });
  it('reads a uid + tv pair as the pinned row', () => {
    expect(
      parseDiscordSigninClaims({ ...base, uid: 4, tv: 2 })?.rebind,
    ).toEqual({ userId: 4, tokenVersion: 2 });
  });
  it.each([
    ['a uid without tv', { uid: 4 }],
    ['a tv without uid', { tv: 2 }],
    ['a string tv', { uid: 4, tv: '2' }],
    ['an unlinked id', { discordId: `unlinked:${SNOWFLAKE}` }],
    ['a local stand-in id', { discordId: 'local:7' }],
    ['an empty username', { username: '' }],
    ['a numeric avatar', { avatar: 5 }],
    ['signin missing', { signin: undefined }],
  ])('rejects %s', (_label, patch) => {
    expect(parseDiscordSigninClaims({ ...base, ...patch })).toBeNull();
  });
  it('treats only digit strings as snowflakes', () => {
    expect(isDiscordSnowflake(SNOWFLAKE)).toBe(true);
    expect(isDiscordSnowflake(`unlinked:${SNOWFLAKE}`)).toBe(false);
    expect(isDiscordSnowflake(null)).toBe(false);
  });
});

describe("MagicLinkService — src:'cmd' links (ROK-2283)", () => {
  const user = (discordId: string | null) => ({
    id: 3,
    username: 'm',
    role: 'member' as const,
    discordId,
    bannedAt: null,
    banReason: null,
    kickedAt: null,
    tokenVersion: 0,
  });

  async function mintMagic(src?: 'cmd'): Promise<string> {
    const link = await magic.generateLink(
      3,
      '/signin-link',
      'https://rl.test',
      src ? { src } : {},
    );
    if (!link) throw new Error('no link');
    expect(link.startsWith('https://rl.test/signin-link#token=')).toBe(true);
    return tokenOf(link);
  }

  it("adds src:'cmd' only when asked", async () => {
    findById.mockResolvedValue(user(SNOWFLAKE));
    expect(jwt.decode<Record<string, unknown>>(await mintMagic()).src).toBe(
      undefined,
    );
    expect(
      jwt.decode<Record<string, unknown>>(await mintMagic('cmd')).src,
    ).toBe('cmd');
  });

  it.each<[string, 'cmd' | undefined, string | null, string | undefined]>([
    ['a cmd link + real Discord id', 'cmd', SNOWFLAKE, SNOWFLAKE],
    ['a plain link', undefined, SNOWFLAKE, undefined],
    ['a cmd link + unlinked id', 'cmd', `unlinked:${SNOWFLAKE}`, undefined],
    ['a cmd link + no Discord id', 'cmd', null, undefined],
  ])('redeem of %s → commandDiscordId %s', async (_l, src, id, expected) => {
    findById.mockResolvedValue(user(id));
    const redeemed = await magic.redeem(await mintMagic(src));
    expect(redeemed.commandDiscordId).toBe(expected);
  });
});
