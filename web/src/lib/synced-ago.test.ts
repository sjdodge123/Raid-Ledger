import { describe, it, expect } from 'vitest';
import { syncedAgo } from './synced-ago';

describe('syncedAgo — the one synced-ago wording (ROK-1595)', () => {
    const NOW = Date.parse('2026-10-12T09:04:30.000Z');

    it('labels "just now", minutes, hours and days', () => {
        expect(syncedAgo('2026-10-12T09:04:00.000Z', NOW)).toBe('just now');
        expect(syncedAgo('2026-10-12T09:00:00.000Z', NOW)).toBe('4 min ago');
        expect(syncedAgo('2026-10-12T07:00:00.000Z', NOW)).toBe('2 h ago');
        expect(syncedAgo('2026-10-11T09:00:00.000Z', NOW)).toBe('1 day ago');
        expect(syncedAgo('2026-10-09T09:00:00.000Z', NOW)).toBe('3 days ago');
    });
});
