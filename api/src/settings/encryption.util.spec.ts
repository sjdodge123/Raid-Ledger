import { encrypt, decrypt, isEncrypted } from './encryption.util';

describe('encryption.util', () => {
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

  describe('decrypt', () => {
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
      // Tamper with the encrypted data
      parts[2] = 'ff' + parts[2].slice(2);
      const tampered = parts.join(':');

      expect(() => decrypt(tampered)).toThrow();
    });
  });

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
});
