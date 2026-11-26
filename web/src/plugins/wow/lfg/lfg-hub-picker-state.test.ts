import { afterEach, describe, expect, it } from 'vitest';
import { blockWebStorage } from '../../../test/block-web-storage';
import {
    LAST_HUB_STORAGE_KEY, hubGameSlug, matchHub, readLastHub, wowHubOptions, writeLastHub,
} from './lfg-hub-picker-state';
import { CLASSIC, FOREVER, REGISTRY, VALHEIM, myHub } from './lfg-hub-picker.fixtures';

afterEach(() => window.localStorage.clear());

describe('hubGameSlug', () => {
    it('uses gameSlug when the summary carries it', () => {
        expect(hubGameSlug(myHub(1, 'A', 999, 'world-of-warcraft-classic'), REGISTRY)).toBe('world-of-warcraft-classic');
    });
    it('falls back to gameId → registry slug (GET /guilds/mine sends no gameSlug)', () => {
        expect(hubGameSlug(myHub(1, 'A', FOREVER.id), REGISTRY)).toBe(FOREVER.slug);
    });
    it('is null for a game the registry does not know', () => {
        expect(hubGameSlug(myHub(1, 'A', 404), REGISTRY)).toBeNull();
    });
});

describe('wowHubOptions', () => {
    it('keeps WoW hubs only, labelled "<hub> · <variant>"', () => {
        const options = wowHubOptions(
            [myHub(1, 'Dawn', FOREVER.id), myHub(2, 'Vikings', VALHEIM.id), myHub(3, 'Old Guard', CLASSIC.id)],
            REGISTRY,
        );
        expect(options.map((o) => o.label)).toEqual(['Dawn · WoW: Forever', 'Old Guard · World of Warcraft Classic']);
    });
});

describe('matchHub', () => {
    const options = wowHubOptions([myHub(1, 'Dawn', FOREVER.id), myHub(3, 'Old Guard', CLASSIC.id)], REGISTRY);
    it('returns the hub when its game is the page game', () => {
        expect(matchHub(1, options, FOREVER.slug)?.hubName).toBe('Dawn');
    });
    it('ignores a hub of another game', () => {
        expect(matchHub(3, options, FOREVER.slug)).toBeNull();
    });
    it('ignores an unknown or missing hub', () => {
        expect(matchHub(77, options, FOREVER.slug)).toBeNull();
        expect(matchHub(null, options, FOREVER.slug)).toBeNull();
    });
});

describe('last-hub storage', () => {
    it('round-trips and forgets', () => {
        writeLastHub(5);
        expect(readLastHub()).toBe(5);
        writeLastHub(null);
        expect(readLastHub()).toBeNull();
    });
    it('treats a malformed value as no pick', () => {
        window.localStorage.setItem(LAST_HUB_STORAGE_KEY, 'abc');
        expect(readLastHub()).toBeNull();
    });
    it('survives blocked storage', () => {
        const restore = blockWebStorage();
        try {
            expect(() => writeLastHub(5)).not.toThrow();
            expect(readLastHub()).toBeNull();
        } finally {
            restore();
        }
    });
});
