import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { MagicLinkService } from './magic-link.service';
import { UsersService } from '../users/users.service';
import { TokenBlocklistService } from './token-blocklist.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { derivePurposeSecret } from './purpose-jwt.helpers';
import { hashToken } from './single-use-token.helpers';

const SECRET = 'magic-spec-secret';
const jwt = new JwtService({ secret: SECRET });
let service: MagicLinkService;
let findById: jest.Mock;
let isBlocked: jest.Mock;
let db: MockDb;

const member = {
  id: 1,
  username: 'a',
  role: 'member' as const,
  bannedAt: null as Date | null,
  banReason: null as string | null,
  kickedAt: null as Date | null,
};

beforeEach(async () => {
  process.env.JWT_SECRET = SECRET;
  findById = jest.fn().mockResolvedValue(member);
  isBlocked = jest.fn().mockResolvedValue(false);
  db = createDrizzleMock();
  db.returning.mockResolvedValue([{ id: 1 }]);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MagicLinkService,
      { provide: JwtService, useValue: jwt },
      { provide: UsersService, useValue: { findById } },
      { provide: TokenBlocklistService, useValue: { isBlocked } },
      { provide: DrizzleAsyncProvider, useValue: db },
    ],
  }).compile();
  service = module.get(MagicLinkService);
});

async function mintToken(userId = 1): Promise<string> {
  const link = await service.generateLink(
    userId,
    '/events/42',
    'https://rl.test',
  );
  return new URLSearchParams(new URL(link!).hash.slice(1)).get('token')!;
}

/** A magic-link-purpose token with arbitrary claims (bypasses generateLink). */
function signMagicPurpose(payload: Record<string, unknown>): string {
  return jwt.sign(payload, {
    secret: derivePurposeSecret(SECRET, 'magic-link'),
  });
}

async function redeemError(token: string): Promise<UnauthorizedException> {
  const err: unknown = await service.redeem(token).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UnauthorizedException);
  return err as UnauthorizedException;
}

describe('MagicLinkService.generateLink (ROK-1366 AC1)', () => {
  it('signs only {sub, magicLink} plus a random jti, with a 15-minute expiry', async () => {
    const decoded = jwt.decode<Record<string, number>>(await mintToken());
    expect(Object.keys(decoded).sort()).toEqual([
      'exp',
      'iat',
      'jti',
      'magicLink',
      'sub',
    ]);
    expect(decoded.sub).toBe(1);
    expect(decoded.magicLink).toBe(true);
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });

  it('carries the token in the fragment only, never the query string', async () => {
    const url = new URL(
      (await service.generateLink(3, '/plan', 'https://rl.test'))!,
    );
    expect(url.pathname).toBe('/plan');
    expect(url.search).toBe('');
    expect(url.hash).toMatch(/^#token=/);
  });

  it('is not verifiable with the plain JWT_SECRET', async () => {
    const token = await mintToken();
    expect(() => jwt.verify(token)).toThrow('invalid signature');
  });

  it('is no longer than the legacy JWT_SECRET token for the same user', async () => {
    const legacy = jwt.sign(
      { sub: 1, username: 'a', role: 'member', magicLink: true },
      { expiresIn: '15m' },
    );
    const token = await mintToken();
    expect(jwt.decode<Record<string, unknown>>(token).jti).toEqual(
      expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
    );
    expect(token.length).toBeLessThanOrEqual(legacy.length);
  });

  it('mints distinct links for one user in the same second, each spending only itself', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now());
    let a: string, b: string;
    try {
      [a, b] = [await mintToken(), await mintToken()];
    } finally {
      now.mockRestore();
    }
    expect(a).not.toBe(b);
    await service.redeem(a);
    expect(db.values).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith({ tokenHash: hashToken(a) });
    expect(hashToken(b)).not.toBe(hashToken(a));
  });

  it('returns null and signs nothing for an unknown user', async () => {
    findById.mockResolvedValueOnce(undefined);
    await expect(
      service.generateLink(999, '/x', 'https://rl.test'),
    ).resolves.toBeNull();
  });
});

describe('MagicLinkService.redeem — token checks (AC3/AC4)', () => {
  it('returns the reloaded user and consumes sha256(token)', async () => {
    const token = await mintToken();
    await expect(service.redeem(token)).resolves.toEqual({
      id: 1,
      username: 'a',
      role: 'member',
    });
    expect(db.values).toHaveBeenCalledWith({ tokenHash: hashToken(token) });
  });

  it('401s a replay (hash already consumed)', async () => {
    const token = await mintToken();
    db.returning.mockResolvedValueOnce([]);
    await redeemError(token);
    expect(findById).toHaveBeenCalledTimes(1); // generateLink only
  });

  it('401s expired, garbage, JWT_SECRET-signed and access tokens with one body, consuming none', async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      signMagicPurpose({
        sub: 1,
        magicLink: true,
        iat: now - 1000,
        exp: now - 100,
      }),
      'not.a.jwt',
      jwt.sign({ sub: 1, username: 'a', role: 'member', magicLink: true }),
      jwt.sign({ sub: 1, username: 'a', role: 'member' }),
      signMagicPurpose({ sub: 1 }),
    ];
    const bodies = await Promise.all(
      bad.map(async (t) => (await redeemError(t)).getResponse()),
    );
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('MagicLinkService.redeem — user checks after consuming (AC6)', () => {
  it('401s a user who no longer exists, after consuming', async () => {
    const token = await mintToken();
    findById.mockResolvedValueOnce(undefined);
    await redeemError(token);
    expect(db.values).toHaveBeenCalledWith({ tokenHash: hashToken(token) });
  });

  it('401s a banned user, after consuming', async () => {
    const token = await mintToken();
    findById.mockResolvedValueOnce({ ...member, bannedAt: new Date() });
    await redeemError(token);
    expect(db.values).toHaveBeenCalledWith({ tokenHash: hashToken(token) });
  });

  it('401s a user inside the kick cooldown', async () => {
    const token = await mintToken();
    findById.mockResolvedValueOnce({ ...member, kickedAt: new Date() });
    await redeemError(token);
  });

  it('401s a token blocklisted at its iat', async () => {
    const token = await mintToken();
    isBlocked.mockResolvedValueOnce(true);
    await redeemError(token);
    const { iat } = jwt.decode<{ iat: number }>(token);
    expect(isBlocked).toHaveBeenCalledWith(1, iat);
  });
});
