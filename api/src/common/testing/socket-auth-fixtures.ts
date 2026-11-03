import type { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { clearAuthUserCache } from '../../auth/auth-user-cache';

/**
 * Shared socket-handshake session cases (tech-debt 2026-10-20): every
 * socket.io gateway must refuse what the HTTP `JwtStrategy` refuses.
 */

export type SocketAuthDb = PostgresJsDatabase<typeof schema>;

export const ACTIVE_AUTH_ROW = {
  role: 'member',
  discordId: '12345',
  deactivatedAt: null as Date | null,
  kickedAt: null as Date | null,
  bannedAt: null as Date | null,
  banReason: null as string | null,
  tokenVersion: 0,
};

/** A db whose `select().from().where().limit()` resolves to `rows`. */
export function mockAuthDb(rows: (typeof ACTIVE_AUTH_ROW)[]): SocketAuthDb {
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const db = { select: jest.fn().mockReturnValue({ from }) };
  return db as unknown as SocketAuthDb;
}

interface ConnectingGateway {
  handleConnection(client: Socket): Promise<void>;
}

type BuildGateway = (jwt: JwtService, db: SocketAuthDb) => ConnectingGateway;

const SECRET = 'socket-session-spec-secret';

/** Handshake with a token carrying `claims`; returns the socket's disconnect mock. */
async function connect(
  build: BuildGateway,
  row: typeof ACTIVE_AUTH_ROW,
  claims: Record<string, unknown>,
): Promise<jest.Mock> {
  const jwt = new JwtService({ secret: SECRET });
  const token = jwt.sign({ sub: 1, username: 'u', ...claims });
  const disconnect = jest.fn();
  const client = {
    id: 'client-session',
    handshake: { auth: { token } },
    disconnect,
  } as unknown as Socket;
  await build(jwt, mockAuthDb([row])).handleConnection(client);
  return disconnect;
}

const REFUSED: [string, typeof ACTIVE_AUTH_ROW, Record<string, unknown>][] = [
  [
    'a deactivated user',
    { ...ACTIVE_AUTH_ROW, deactivatedAt: new Date() },
    { tv: 0 },
  ],
  [
    'a banned user',
    { ...ACTIVE_AUTH_ROW, bannedAt: new Date(), banReason: 'x' },
    { tv: 0 },
  ],
  [
    'a token whose version was bumped (revoked)',
    { ...ACTIVE_AUTH_ROW, tokenVersion: 3 },
    { tv: 2 },
  ],
  ['a token minted before the version claim', ACTIVE_AUTH_ROW, {}],
];

/** valid connects; deactivated / banned / stale token version are refused. */
export function describeSocketSessionChecks(
  name: string,
  build: BuildGateway,
): void {
  describe(`${name} — handshake session checks`, () => {
    beforeEach(() => clearAuthUserCache());
    afterAll(() => clearAuthUserCache());

    it('keeps a current-version token for an active user', async () => {
      const disconnect = await connect(build, ACTIVE_AUTH_ROW, { tv: 0 });
      expect(disconnect).not.toHaveBeenCalled();
    });

    it.each(REFUSED)('disconnects %s', async (_label, row, claims) => {
      const disconnect = await connect(build, row, claims);
      expect(disconnect).toHaveBeenCalledWith(true);
    });
  });
}
