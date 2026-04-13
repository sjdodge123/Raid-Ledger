/**
 * Re-encryption Script Integration Tests (ROK-1035)
 *
 * Verifies that the re-encryption script can decrypt all app_settings
 * rows encrypted with an old key and re-encrypt them with a new key.
 *
 * This import will fail until the dev agent creates the script —
 * which is correct for TDD (the test must fail first).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { appSettings } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * Import the re-encryption function from the script that doesn't
 * exist yet. This WILL produce a "Cannot find module" error, which
 * is the expected TDD failure mode.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reencryptMod = require('../../scripts/reencrypt-settings') as {
  reencryptAllSettings?: (
    db: unknown,
    oldKey: Buffer,
    newKey: Buffer,
  ) => Promise<number>;
};
const reencryptAllSettings = reencryptMod.reencryptAllSettings;

/**
 * Inline encrypt/decrypt helpers that use an explicit key.
 * These mirror the expected encryptWithKey/decryptWithKey API from
 * encryption.util.ts so the test can seed data independently of
 * the process.env.JWT_SECRET-based encrypt/decrypt.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const encMod = require('./encryption.util') as {
  deriveKey?: (secret: string) => Buffer;
  encryptWithKey?: (text: string, key: Buffer) => string;
  decryptWithKey?: (text: string, key: Buffer) => string;
};

function describeReencryptSettings() {
  let testApp: TestApp;

  const OLD_SECRET = 'old-jwt-secret-for-testing';
  const NEW_SECRET = 'new-jwt-secret-for-testing';

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('should re-encrypt all app_settings rows from old key to new key', async () => {
    const oldKey = encMod.deriveKey!(OLD_SECRET);
    const newKey = encMod.deriveKey!(NEW_SECRET);

    // Seed rows encrypted with the old key
    const rows = [
      { key: 'test_secret_a', value: 'value-alpha' },
      { key: 'test_secret_b', value: 'value-bravo' },
      { key: 'test_secret_c', value: 'value-charlie' },
    ];

    for (const row of rows) {
      const encrypted = encMod.encryptWithKey!(row.value, oldKey);
      await testApp.db.insert(appSettings).values({
        key: row.key,
        encryptedValue: encrypted,
      });
    }

    // Run re-encryption
    const count = await reencryptAllSettings!(testApp.db, oldKey, newKey);
    expect(count).toBe(3);

    // Verify each row is now encrypted with the new key
    for (const row of rows) {
      const [dbRow] = await testApp.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, row.key));

      // Decrypting with the new key should yield the original value
      const decrypted = encMod.decryptWithKey!(dbRow.encryptedValue, newKey);
      expect(decrypted).toBe(row.value);

      // Decrypting with the old key should fail (data was re-encrypted)
      expect(() =>
        encMod.decryptWithKey!(dbRow.encryptedValue, oldKey),
      ).toThrow();
    }
  });

  it('should handle empty app_settings table gracefully', async () => {
    const oldKey = encMod.deriveKey!(OLD_SECRET);
    const newKey = encMod.deriveKey!(NEW_SECRET);

    // No rows seeded — table is empty after truncation
    const count = await reencryptAllSettings!(testApp.db, oldKey, newKey);
    expect(count).toBe(0);
  });
}
describe('reencrypt-settings (integration)', () => describeReencryptSettings());
