/**
 * DemoTestSignInLinkController — POST /admin/test/sign-in-link.
 *
 * Uses the REAL MagicLinkService (JwtService + UsersService stubbed) so the
 * asserted url is the one the web app would actually receive.
 */
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DemoTestSignInLinkController } from './demo-test-sign-in-link.controller';
import { isSafeRelativePath } from './demo-test-sign-in-link.helpers';
import { MagicLinkService } from '../auth/magic-link.service';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

type Ctor = ConstructorParameters<typeof DemoTestSignInLinkController>;
type MagicCtor = ConstructorParameters<typeof MagicLinkService>;

const CLIENT = 'https://slot-1.gamernight.net';

function setup(opts: { dbDemo?: boolean; knownIds?: number[] } = {}) {
  const known = new Set(opts.knownIds ?? [7, 12]);
  const users = {
    findById: jest.fn((id: number) =>
      Promise.resolve(
        known.has(id) ? { id, username: `u${id}`, role: 'member' } : undefined,
      ),
    ),
  };
  const jwt = { sign: jest.fn().mockReturnValue('tok.en.sig') };
  const magic = new MagicLinkService(
    jwt as unknown as MagicCtor[0],
    users as unknown as MagicCtor[1],
  );
  const generateLink = jest.spyOn(magic, 'generateLink');
  const db: MockDb = createDrizzleMock();
  const settings = {
    getDemoMode: jest.fn().mockResolvedValue(opts.dbDemo ?? true),
  };
  const controller = new DemoTestSignInLinkController(
    db as unknown as Ctor[0],
    settings as unknown as Ctor[1],
    magic,
  );
  return { controller, db, generateLink, jwt };
}

describe('DemoTestSignInLinkController — POST /admin/test/sign-in-link', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.DEMO_MODE = 'true';
    process.env.CLIENT_URL = CLIENT;
    delete process.env.CORS_ORIGIN;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('userId → magic link for that user on the requested path', async () => {
    const { controller, generateLink } = setup();
    const res = await controller.signInLink({ userId: 7, path: '/events/3' });
    expect(res).toEqual({
      url: `${CLIENT}/events/3#token=tok.en.sig`,
      userId: 7,
      expiresInSeconds: 900,
    });
    expect(generateLink).toHaveBeenCalledWith(7, '/events/3', CLIENT);
  });

  it('defaults path to "/"', async () => {
    const { controller, generateLink } = setup();
    const res = await controller.signInLink({ userId: 7 });
    expect(res.url).toBe(`${CLIENT}/#token=tok.en.sig`);
    expect(generateLink).toHaveBeenCalledWith(7, '/', CLIENT);
  });

  it('falls back to CORS_ORIGIN when CLIENT_URL is unset', async () => {
    delete process.env.CLIENT_URL;
    process.env.CORS_ORIGIN = 'https://slot-2.gamernight.net';
    const { controller } = setup();
    const res = await controller.signInLink({ userId: 7 });
    expect(res.url).toBe('https://slot-2.gamernight.net/#token=tok.en.sig');
  });

  it('username → resolves the user id, then mints the link', async () => {
    const { controller, db, generateLink } = setup();
    db.limit.mockResolvedValueOnce([{ id: 12 }]);
    const res = await controller.signInLink({ username: 'u12', path: '/x' });
    expect(res).toEqual({
      url: `${CLIENT}/x#token=tok.en.sig`,
      userId: 12,
      expiresInSeconds: 900,
    });
    expect(generateLink).toHaveBeenCalledWith(12, '/x', CLIENT);
  });

  it('404 when the username matches no user', async () => {
    const { controller, db, generateLink } = setup();
    db.limit.mockResolvedValueOnce([]);
    await expect(
      controller.signInLink({ username: 'ghost' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('404 when the userId does not exist', async () => {
    const { controller, jwt } = setup({ knownIds: [] });
    await expect(controller.signInLink({ userId: 999 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it.each([
    ['both ids', { userId: 7, username: 'u7' }],
    ['neither id', { path: '/' }],
    ['empty body', undefined],
    ['string userId', { userId: '7' }],
    ['zero userId', { userId: 0 }],
    ['blank username', { username: '  ' }],
    ['protocol-relative path', { userId: 7, path: '//evil.com' }],
    ['absolute url path', { userId: 7, path: 'https://x' }],
    ['no leading slash', { userId: 7, path: 'events/3' }],
    ['backslash path', { userId: 7, path: '/\\evil.com' }],
    ['javascript scheme', { userId: 7, path: 'javascript:alert(1)' }],
    ['non-string path', { userId: 7, path: 42 }],
  ])('400 on %s', async (_label, body) => {
    const { controller, generateLink } = setup();
    await expect(controller.signInLink(body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('403 when DEMO_MODE env is off — before any parsing or lookup', async () => {
    process.env.DEMO_MODE = 'false';
    const { controller, generateLink } = setup();
    await expect(controller.signInLink({ userId: 7 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.signInLink({})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('403 when the DB demo-mode flag is off', async () => {
    const { controller, generateLink } = setup({ dbDemo: false });
    await expect(controller.signInLink({ userId: 7 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('500 when no client url is configured', async () => {
    delete process.env.CLIENT_URL;
    process.env.CORS_ORIGIN = 'auto';
    const { controller, generateLink } = setup();
    await expect(controller.signInLink({ userId: 7 })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(generateLink).not.toHaveBeenCalled();
  });
});

describe('isSafeRelativePath', () => {
  it.each(['/', '/events/3', '/events?tab=2', '/a/b-c_d.e'])(
    'accepts %s',
    (p) => expect(isSafeRelativePath(p)).toBe(true),
  );

  it.each([
    '',
    'events',
    '//evil.com',
    '/\\evil.com',
    'https://x',
    '/a b',
    '/a\nb',
    '/a#frag',
  ])('rejects %j', (p) => expect(isSafeRelativePath(p)).toBe(false));
});
