import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/** Secrets that must never be used in production. */
const BANNED_SECRETS = [
  'raid-ledger-default-secret-change-in-production',
  'dev-encryption-key-change-me',
];

/**
 * Cached derived key + the secret it was derived from.
 * scryptSync is intentionally slow (~100ms per call on ARM/NAS hardware).
 * Caching avoids re-deriving 40+ times per settings cache reload.
 */
let cachedKey: Buffer | null = null;
let cachedKeySecret: string | null = null;

/**
 * Derives a 32-byte AES key from a secret string using scrypt.
 * Pure function — no caching, no side effects.
 */
export function deriveKey(secret: string): Buffer {
  const salt = Buffer.from(
    secret.slice(0, SALT_LENGTH).padEnd(SALT_LENGTH, '0'),
  );
  return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Derives encryption key from JWT_SECRET using scrypt.
 * Falls back to a default key for development if JWT_SECRET is not set.
 * Result is cached per-process — only re-derives if JWT_SECRET changes.
 *
 * In production, throws if the secret is a known banned/insecure value.
 */
export function getEncryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET || 'dev-encryption-key-change-me';

  if (
    process.env.NODE_ENV === 'production' &&
    BANNED_SECRETS.includes(secret)
  ) {
    throw new Error(
      'Insecure JWT_SECRET detected: default secret or banned value ' +
        'must not be used in production. Set a real JWT_SECRET.',
    );
  }

  if (cachedKey && cachedKeySecret === secret) return cachedKey;
  cachedKey = deriveKey(secret);
  cachedKeySecret = secret;
  return cachedKey;
}

/** @internal Exposed for testing only — clears the cached key. */
export function _resetKeyCache(): void {
  cachedKey = null;
  cachedKeySecret = null;
}

/**
 * Encrypts a string value using AES-256-GCM with a specific key.
 * Returns format: iv:authTag:encryptedData (all hex encoded)
 */
export function encryptWithKey(text: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a value using AES-256-GCM with a specific key.
 * Expects format: iv:authTag:encryptedData (all hex encoded)
 */
export function decryptWithKey(encryptedText: string, key: Buffer): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Encrypts a string value using AES-256-GCM with the process JWT_SECRET.
 * Returns format: iv:authTag:encryptedData (all hex encoded)
 */
export function encrypt(text: string): string {
  return encryptWithKey(text, getEncryptionKey());
}

/**
 * Decrypts a value encrypted with the encrypt() function.
 * Expects format: iv:authTag:encryptedData (all hex encoded)
 */
export function decrypt(encryptedText: string): string {
  return decryptWithKey(encryptedText, getEncryptionKey());
}

/**
 * Checks if a string appears to be an encrypted value.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [ivHex, authTagHex, encryptedHex] = parts;
  return (
    ivHex.length === IV_LENGTH * 2 &&
    authTagHex.length === AUTH_TAG_LENGTH * 2 &&
    encryptedHex.length > 0
  );
}
