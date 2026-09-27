import { JwtService } from '@nestjs/jwt';
import { LinkNonceService, LINK_NONCE_TTL_SECONDS } from './link-nonce.service';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { derivePurposeSecret } from './purpose-jwt.helpers';
import { hashToken } from './single-use-token.helpers';

/** ROK-1630 (OQ1/OQ2 rulings): signed, provider-bound, single-use, 120s. */
const SECRET = 'nonce-spec-secret';
const jwt = new JwtService({ secret: SECRET });
let db: MockDb;
let service: LinkNonceService;

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  db = createDrizzleMock();
  db.returning.mockResolvedValue([{ id: 1 }]);
  service = new LinkNonceService(jwt, db as never);
});

describe('LinkNonceService.mint', () => {
  it('returns a nonce with a 120s TTL carrying {sub, returnTo}', () => {
    const { nonce, expiresIn } = service.mint('steam', 7, '/onboarding');
    expect(expiresIn).toBe(120);
    expect(LINK_NONCE_TTL_SECONDS).toBe(120);
    const decoded = jwt.decode<Record<string, unknown>>(nonce);
    expect(decoded).toMatchObject({ sub: 7, returnTo: '/onboarding' });
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(120);
  });

  it('omits returnTo when none is given (Discord)', () => {
    const decoded = jwt.decode<Record<string, unknown>>(
      service.mint('discord', 7).nonce,
    );
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('is not verifiable with the plain JWT_SECRET', () => {
    expect(() => jwt.verify(service.mint('discord', 7).nonce)).toThrow(
      'invalid signature',
    );
  });
});

describe('LinkNonceService.consume', () => {
  it('returns {userId, returnTo} once and consumes sha256(nonce)', async () => {
    const { nonce } = service.mint('steam', 7, '/profile');
    await expect(service.consume('steam', nonce)).resolves.toEqual({
      userId: 7,
      returnTo: '/profile',
    });
    expect(db.values).toHaveBeenCalledWith({ tokenHash: hashToken(nonce) });
  });

  it('returns null on replay (hash already consumed)', async () => {
    const { nonce } = service.mint('discord', 7);
    db.returning.mockResolvedValueOnce([]);
    await expect(service.consume('discord', nonce)).resolves.toBeNull();
  });

  it('returns null — without consuming — for cross-provider, expired, missing, access-token and garbage input', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = jwt.sign(
      { sub: 7, iat: now - 500, exp: now - 10 },
      { secret: derivePurposeSecret(SECRET, 'link-nonce:discord') },
    );
    const inputs: Array<['discord' | 'steam', string | undefined]> = [
      ['steam', service.mint('discord', 7).nonce],
      ['discord', expired],
      ['discord', undefined],
      ['discord', ''],
      ['discord', jwt.sign({ sub: 7, username: 'a', role: 'member' })],
      ['steam', 'garbage'],
    ];
    for (const [provider, input] of inputs) {
      await expect(service.consume(provider, input)).resolves.toBeNull();
    }
    expect(db.insert).not.toHaveBeenCalled();
  });
});
