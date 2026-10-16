import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { SettingsCore } from '../../settings/settings-bot.helpers';
import { loadFeedView } from './calendar-feed-view.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const svc = {
  get: jest.fn().mockResolvedValue('https://raid.example.test'),
} as unknown as SettingsCore;

describe('loadFeedView', () => {
  it('treats a token that cannot be decrypted as no feed (never fails the page)', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([{ tokenEncrypted: 'not-a-ciphertext' }]);
    await expect(loadFeedView(db as unknown as Db, svc, 7)).resolves.toBeNull();
  });

  it('is null when the user has no feed', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([]);
    await expect(loadFeedView(db as unknown as Db, svc, 7)).resolves.toBeNull();
  });
});
