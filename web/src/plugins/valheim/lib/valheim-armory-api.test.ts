/** ROK-1836 — armory client paths, the blob-path guard and the shape lock. */
import { describe, it, expect, vi } from 'vitest';
import { server } from '../../../test/mocks/server';
import { SchemaValidationError } from '../../../lib/api/fetch-api';
import {
    valheimCharacterClaimed,
    valheimCharactersHandler,
    valheimCharacterHandler,
    valheimCharacterDetail,
} from '../../../test/mocks/valheim-armory-handlers';
import {
    fetchValheimCharacter,
    fetchValheimCharacters,
    isNotFoundError,
    valheimBlobPath,
    valheimCharacterPath,
    valheimCharactersPath,
} from './valheim-armory-api';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const SHA = 'a'.repeat(64);

describe('valheim armory paths', () => {
    it('lists a server page with serverId, page and pageSize', () => {
        expect(valheimCharactersPath(7, 2, 25)).toBe(
            '/plugins/valheim/armory/characters?serverId=7&page=2&pageSize=25',
        );
    });
    it('builds the detail path', () => {
        expect(valheimCharacterPath(11)).toBe(
            '/plugins/valheim/armory/characters/11',
        );
    });
    it('builds the content-addressed blob path', () => {
        expect(valheimBlobPath(7, SHA)).toBe(
            `/plugins/valheim/armory/servers/7/blobs/${SHA}`,
        );
    });
    it.each([
        ['../../admin'],
        ['A'.repeat(64)],
        ['a'.repeat(63)],
        [`${'a'.repeat(63)}/`],
    ])('refuses a blob hash that is not lowercase hex sha256: %s', (bad) => {
        expect(() => valheimBlobPath(7, bad)).toThrow('Invalid blob hash');
    });
    it('refuses a non-positive server id', () => {
        expect(() => valheimBlobPath(0, SHA)).toThrow('Invalid server id');
    });
});

describe('valheim armory fetchers', () => {
    it('returns the list response (rows + optional total)', async () => {
        server.use(valheimCharactersHandler([valheimCharacterClaimed]));
        await expect(fetchValheimCharacters(7, 1)).resolves.toEqual({
            data: [valheimCharacterClaimed],
        });
    });
    it('rejects a detail that breaks the contract (shape lock)', async () => {
        server.use(
            valheimCharacterHandler({
                ...valheimCharacterDetail(),
                steamId: '765',
            }),
        );
        await expect(fetchValheimCharacter(12)).rejects.toBeInstanceOf(
            SchemaValidationError,
        );
    });
    it('marks a 404 as not-found', async () => {
        server.use(valheimCharacterHandler(null));
        const err = await fetchValheimCharacter(99).catch((e: unknown) => e);
        expect(isNotFoundError(err)).toBe(true);
    });
});
