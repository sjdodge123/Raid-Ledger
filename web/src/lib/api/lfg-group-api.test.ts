import { describe, expect, it } from 'vitest';
import { groupQuery } from './lfg-group-api';

describe('groupQuery', () => {
    it('sends nothing for the whole-game group and encodes a keyed one', () => {
        expect(groupQuery('')).toBe('');
        expect(groupQuery('dungeon:36')).toBe('?group=dungeon%3A36');
        expect(groupQuery('*')).toBe('?group=*');
    });
});
