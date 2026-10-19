import { describe, it, expect } from 'vitest';
import {
    hubPathFrom,
    parseCharacterId,
    valheimCharacterHref,
} from './valheim-routes';

describe('valheim routes', () => {
    it('builds the character href', () =>
        expect(valheimCharacterHref(11)).toBe('/valheim/characters/11'));
    it.each([
        ['11', 11],
        ['0', null],
        ['-1', null],
        ['1.5', null],
        ['abc', null],
        [undefined, null],
        ['01', null],
        ['2147483647', 2147483647],
        ['2147483648', null],
        ['9999999999', null],
    ])('parses route id %s as %s', (raw, want) =>
        expect(parseCharacterId(raw)).toBe(want),
    );
    it('trusts only an in-app /guilds/ hub path from router state', () => {
        expect(hubPathFrom({ hubPath: '/guilds/4#characters' })).toBe(
            '/guilds/4#characters',
        );
        expect(hubPathFrom({ hubPath: 'https://evil.example/' })).toBeNull();
        expect(hubPathFrom({ hubPath: 4 })).toBeNull();
        expect(hubPathFrom(null)).toBeNull();
    });
});
