/**
 * ROK-1809 Codex r2: nothing inside a locked rotation transaction may use the
 * outer pool. The session length (a settings read that can reload through the
 * outer pool) must resolve BEFORE `db.transaction` opens — otherwise, at
 * `DB_POOL_MAX=1`, the reload waits on the connection the transaction holds.
 */
import type Redis from 'ioredis';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import type { TokenBlocklistService } from '../token-blocklist.service';
import type { ImpersonationSessionService } from '../impersonation/impersonation-session.service';
import { RefreshTokenService } from './refresh-token.service';

function build() {
  const order: string[] = [];
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([]),
    transaction: () => {
      order.push('transaction');
      return Promise.resolve(null);
    },
  };
  const settings = {
    get: jest.fn(() => {
      order.push('settings');
      return Promise.resolve(null);
    }),
  };
  const service = new RefreshTokenService(
    chain as unknown as PostgresJsDatabase<typeof schema>,
    settings as unknown as SettingsService,
    {} as TokenBlocklistService,
    {} as Redis,
    {} as ImpersonationSessionService,
  );
  return { service, order };
}

describe('ROK-1809 RefreshTokenService.rotate — no outer-pool read inside the tx', () => {
  it('resolves the session length before opening the rotation transaction', async () => {
    const t = build();
    await expect(t.service.rotate('raw-token')).resolves.toBeNull();
    expect(t.order).toEqual(['settings', 'transaction']);
  });
});
