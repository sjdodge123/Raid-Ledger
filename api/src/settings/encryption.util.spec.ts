import {
  encrypt,
  decrypt,
  isEncrypted,
  _resetKeyCache,
} from './encryption.util';

/**
 * Attempt to import the new exports that ROK-1035 will add.
 * These imports will fail (or resolve to undefined) until the
 * dev agent implements them — which is correct for TDD.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require('./encryption.util') as Record<string, unknown>;
const deriveKey = mod.deriveKey as ((secret: string) => Buffer) | undefined;
const encryptWithKey = mod.encryptWithKey as
  | ((text: string, key: Buffer) => string)
  | undefined;
const decryptWithKey = mod.decryptWithKey as
  | ((text: string, key: Buffer) => string)
  | undefined;
const getEncryptionKey = mod.getEncryptionKey as (() => Buffer) | undefined;

/* ------------------------------------------------------------------ */
/*  Existing tests (unchanged)                                        */
/* ------------------------------------------------------------------ */

function describeEncryptionUtil() {
  beforeAll(() => {
    // Ensure JWT_SECRET is set for consistent testing
    process.env.JWT_SECRET = 'test-jwt-secret-for-encryption-testing';
  });

  describe('encrypt', () => {
    it('should encrypt a string value', () => {
      const plaintext = 'my-secret-value';
      const encrypted = encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(typeof encrypted).toBe('string');
    });

    it('should produce different ciphertext for same plaintext (due to random IV)', () => {
      const plaintext = 'same-value';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      // Different encryptions should produce different ciphertext
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should produce output in expected format (iv:authTag:encrypted)', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');

      expect(parts.length).toBe(3);
      // IV should be 32 hex chars (16 bytes)
      expect(parts[0].length).toBe(32);
      // Auth tag should be 32 hex chars (16 bytes)
      expect(parts[1].length).toBe(32);
      // Encrypted data should exist
      expect(parts[2].length).toBeGreaterThan(0);
    });
  });

  function describeDecrypt() {
    it('should decrypt an encrypted value back to original', () => {
      const plaintext = 'my-secret-value';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty string', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', () => {
      const plaintext = '!@#$%^&*()_+-=[]{}|;:",.<>?/`~';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', () => {
      const plaintext = '日本語テスト 🔐 السلام عليكم';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw on invalid format', () => {
      expect(() => decrypt('invalid')).toThrow(
        'Invalid encrypted value format',
      );
      expect(() => decrypt('one:two')).toThrow(
        'Invalid encrypted value format',
      );
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');
      // Tamper with the encrypted data (ensure byte actually changes)
      const firstByte = parts[2].slice(0, 2);
      parts[2] = (firstByte === 'ff' ? '00' : 'ff') + parts[2].slice(2);
      const tampered = parts.join(':');

      expect(() => decrypt(tampered)).toThrow();
    });
  }
  describe('decrypt', () => describeDecrypt());

  describe('isEncrypted', () => {
    it('should return true for encrypted values', () => {
      const encrypted = encrypt('test');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plain text', () => {
      expect(isEncrypted('plain-text')).toBe(false);
      expect(isEncrypted('not:encrypted')).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });

    it('should return false for malformed encrypted strings', () => {
      expect(isEncrypted('short:short:data')).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  ROK-1035: New exports and production-rejection behavior          */
  /* ---------------------------------------------------------------- */

  describe('deriveKey (ROK-1035)', () => {
    it('should be exported as a function', () => {
      expect(typeof deriveKey).toBe('function');
    });

    it('should produce a deterministic 32-byte Buffer for a given secret', () => {
      const key1 = deriveKey!('my-secret');
      const key2 = deriveKey!('my-secret');

      expect(Buffer.isBuffer(key1)).toBe(true);
      expect(key1.length).toBe(32);
      expect(key1.equals(key2)).toBe(true);
    });

    it('should produce different keys for different secrets', () => {
      const keyA = deriveKey!('secret-a');
      const keyB = deriveKey!('secret-b');

      expect(keyA.equals(keyB)).toBe(false);
    });
  });

  describe('encryptWithKey (ROK-1035)', () => {
    it('should be exported as a function', () => {
      expect(typeof encryptWithKey).toBe('function');
    });

    it('should encrypt text using a specific key', () => {
      const key = deriveKey!('test-secret');
      const ciphertext = encryptWithKey!('hello world', key);

      expect(typeof ciphertext).toBe('string');
      expect(ciphertext).not.toBe('hello world');
      // Should follow the iv:authTag:encrypted format
      expect(ciphertext.split(':').length).toBe(3);
    });
  });

  describe('decryptWithKey (ROK-1035)', () => {
    it('should be exported as a function', () => {
      expect(typeof decryptWithKey).toBe('function');
    });

    it('should round-trip: decrypt text encrypted with the same key', () => {
      const key = deriveKey!('round-trip-secret');
      const plaintext = 'sensitive data here';
      const ciphertext = encryptWithKey!(plaintext, key);
      const result = decryptWithKey!(ciphertext, key);

      expect(result).toBe(plaintext);
    });

    it('should fail when decrypting with a different key', () => {
      const keyA = deriveKey!('key-a-secret');
      const keyB = deriveKey!('key-b-secret');

      const ciphertext = encryptWithKey!('cross-key test', keyA);

      expect(() => decryptWithKey!(ciphertext, keyB)).toThrow();
    });
  });

  describe('getEncryptionKey production rejection (ROK-1035)', () => {
    const HARDCODED_DEFAULT = 'raid-ledger-default-secret-change-in-production';
    const DEV_FALLBACK = 'dev-encryption-key-change-me';

    afterEach(() => {
      // Restore non-production env and clear cache
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'test-jwt-secret-for-encryption-testing';
      _resetKeyCache();
    });

    it('should be exported as a function', () => {
      expect(typeof getEncryptionKey).toBe('function');
    });

    it('should throw in production when JWT_SECRET is the hardcoded default', () => {
      // Guard: function must exist (not just TypeError from undefined)
      expect(typeof getEncryptionKey).toBe('function');

      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = HARDCODED_DEFAULT;
      _resetKeyCache();

      expect(() => getEncryptionKey!()).toThrow(
        /default.*secret|insecure|banned/i,
      );
    });

    it('should throw in production when JWT_SECRET is the dev fallback', () => {
      // Guard: function must exist (not just TypeError from undefined)
      expect(typeof getEncryptionKey).toBe('function');

      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = DEV_FALLBACK;
      _resetKeyCache();

      expect(() => getEncryptionKey!()).toThrow(
        /default.*secret|insecure|banned/i,
      );
    });

    it('should NOT throw in non-production when JWT_SECRET is the dev fallback', () => {
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = DEV_FALLBACK;
      _resetKeyCache();

      expect(() => getEncryptionKey!()).not.toThrow();
    });

    it('should NOT throw in production with a real secret', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a-real-strong-production-secret';
      _resetKeyCache();

      expect(() => getEncryptionKey!()).not.toThrow();
    });
  });
}
describe('encryption.util', () => describeEncryptionUtil());
