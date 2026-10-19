import { describe, it, expect, vi, afterEach } from 'vitest';
import { ownerChip, updatedAgo } from './valheim-owner.helpers';

const owner = { id: 3, username: 'member1', avatar: null };

describe('ownerChip', () => {
    it('flags an unclaimed character as a warning', () => {
        expect(ownerChip({ claimedBy: null, claimSource: null })).toMatchObject({ tone: 'warning', label: 'Unclaimed' });
    });
    it('names an admin assignment', () => {
        expect(ownerChip({ claimedBy: owner, claimSource: 'admin' }).label).toBe('Assigned by an admin');
    });
    it.each([['manual'], ['auto']] as const)('labels a %s claim as Claimed', (src) => {
        expect(ownerChip({ claimedBy: owner, claimSource: src }).label).toBe('Claimed');
    });
});

describe('updatedAgo', () => {
    afterEach(() => vi.useRealTimers());
    it('is relative to now', () => {
        const now = new Date('2026-10-19T13:00:00.000Z');
        expect(updatedAgo('2026-10-19T10:00:00.000Z', now)).toBe('Updated about 3 hours ago');
    });
    it('never shows a future time', () => {
        expect(updatedAgo('2099-01-01T00:00:00.000Z', new Date('2026-10-19T00:00:00.000Z'))).toBe('Updated just now');
    });
});
