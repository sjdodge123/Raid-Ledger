/**
 * ROK-1960 — the pure-JS SHA-256 fallback against the FIPS 180-4 / NIST
 * vectors, each also cross-checked against WebCrypto so the two paths of
 * `sha256Hex` cannot disagree.
 */
import { describe, expect, it } from 'vitest';
import { hasSubtleCrypto, sha256HexSync } from './bg3-sha256';

async function webCryptoHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const VECTORS: readonly (readonly [label: string, input: string, hex: string])[] = [
    ['empty string', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['"abc"', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
        'the 56-byte two-block message',
        'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['1,000,000 × "a"', 'a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
];

describe('sha256HexSync', () => {
    it.each(VECTORS)('matches the NIST vector and WebCrypto for %s', async (_label, input, hex) => {
        const bytes = new TextEncoder().encode(input);
        expect(sha256HexSync(bytes)).toBe(hex);
        expect(sha256HexSync(bytes)).toBe(await webCryptoHex(bytes));
    });

    it('matches WebCrypto for a multi-byte UTF-8 save-folder name', async () => {
        const bytes = new TextEncoder().encode('Tav-Ünïcødé 🐉 世界__QuickSave_1');
        expect(bytes.length).toBeGreaterThan(30);
        expect(sha256HexSync(bytes)).toBe(await webCryptoHex(bytes));
    });

    it('reports WebCrypto as usable in the test environment', () => {
        expect(hasSubtleCrypto()).toBe(true);
    });
});
