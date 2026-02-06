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

/**
 * Derives encryption key from JWT_SECRET using scrypt.
 * Falls back to a default key for development if JWT_SECRET is not set.
 */
function getEncryptionKey(): Buffer {
    const secret = process.env.JWT_SECRET || 'dev-encryption-key-change-me';
    // Use a fixed salt derived from the secret for deterministic key generation
    const salt = Buffer.from(secret.slice(0, SALT_LENGTH).padEnd(SALT_LENGTH, '0'));
    return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypts a string value using AES-256-GCM.
 * Returns format: iv:authTag:encryptedData (all hex encoded)
 */
export function encrypt(text: string): string {
    const key = getEncryptionKey();
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
 * Decrypts a value encrypted with the encrypt() function.
 * Expects format: iv:authTag:encryptedData (all hex encoded)
 */
export function decrypt(encryptedText: string): string {
    const key = getEncryptionKey();
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
 * Checks if a string appears to be an encrypted value.
 */
export function isEncrypted(value: string): boolean {
    const parts = value.split(':');
    if (parts.length !== 3) return false;

    const [ivHex, authTagHex, encryptedHex] = parts;

    // Check expected lengths (hex encoded)
    return (
        ivHex.length === IV_LENGTH * 2 &&
        authTagHex.length === AUTH_TAG_LENGTH * 2 &&
        encryptedHex.length > 0
    );
}
