/**
 * ROK-1875 D4 — one Hubs nav item, so one active rule: `/hubs` and every hub
 * page (any kind) light it. Replaces the ROK-1870 Guild-vs-Hubs split.
 */
import { describe, expect, it } from 'vitest';
import { hubIdFromPath, isHubsNavActive } from './use-hub-nav-active';

describe('isHubsNavActive', () => {
    it('parses the hub id from a hub path only', () => {
        expect(hubIdFromPath('/guilds/310')).toBe(310);
        expect(hubIdFromPath('/guilds/310/settings')).toBe(310);
        expect(hubIdFromPath('/players')).toBe(0);
    });

    it('the directory lights Hubs', () => {
        expect(isHubsNavActive('/hubs')).toBe(true);
    });

    it('every hub page lights Hubs, whatever its kind', () => {
        expect(isHubsNavActive('/guilds/310')).toBe(true);
        expect(isHubsNavActive('/guilds/11/settings')).toBe(true);
    });

    it('other pages do not', () => {
        expect(isHubsNavActive('/players')).toBe(false);
        expect(isHubsNavActive('/hubsx')).toBe(false);
        expect(isHubsNavActive('/guilds')).toBe(false);
    });
});
