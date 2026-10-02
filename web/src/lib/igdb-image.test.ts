/**
 * ROK-1159: cover `srcset` derivation.
 *
 * The load-bearing assertion is the NEGATIVE one: ITAD boxart and Steam URLs
 * have no rendition API, so emitting a rewritten srcset for them would point
 * the browser at URLs that 404.
 */
import { describe, it, expect } from 'vitest';
import {
    coverSrcSet,
    coverSrcSetProps,
    isIgdbImageUrl,
    screenshotSrcSetProps,
    COVER_INTRINSIC,
    SCREENSHOT_INTRINSIC,
} from './igdb-image';

const IGDB = 'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg';

describe('isIgdbImageUrl', () => {
    it('accepts an IGDB URL carrying a rewritable rendition segment', () => {
        expect(isIgdbImageUrl(IGDB)).toBe(true);
    });

    it('rejects an images.igdb.com URL with no t_* rendition segment', () => {
        expect(isIgdbImageUrl('https://images.igdb.com/cover.jpg')).toBe(false);
    });

    it.each([
        ['ITAD boxart', 'https://assets.isthereanydeal.com/boxart/abc.jpg'],
        ['Steam CDN', 'https://cdn.akamai.steamstatic.com/steam/apps/1/header.jpg'],
        ['relative upload', '/uploads/cover.png'],
    ])('rejects a non-IGDB cover source (%s)', (_label, url) => {
        expect(isIgdbImageUrl(url)).toBe(false);
    });

    it.each([[null], [undefined]])('rejects %s', (url) => {
        expect(isIgdbImageUrl(url as null | undefined)).toBe(false);
    });
});

describe('coverSrcSet', () => {
    it('offers the small, big and 2x renditions with their true widths', () => {
        expect(coverSrcSet(IGDB)).toBe(
            'https://images.igdb.com/igdb/image/upload/t_cover_small/co4jni.jpg 90w, ' +
            'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg 264w, ' +
            'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co4jni.jpg 528w',
        );
    });

    it('rewrites the rendition segment whatever size the API stored', () => {
        const fromSmall = coverSrcSet('https://images.igdb.com/igdb/image/upload/t_thumb/co4jni.jpg');
        expect(fromSmall).toContain('t_cover_big/co4jni.jpg 264w');
        expect(fromSmall).not.toContain('t_thumb');
    });

    it('returns null for ITAD boxart rather than inventing a rendition', () => {
        expect(coverSrcSet('https://assets.isthereanydeal.com/boxart/abc.jpg')).toBeNull();
    });
});

describe('coverSrcSetProps', () => {
    it('carries srcSet plus the caller-supplied sizes for an IGDB cover', () => {
        expect(coverSrcSetProps(IGDB, '40px')).toEqual({
            srcSet: coverSrcSet(IGDB),
            sizes: '40px',
        });
    });

    it('spreads to nothing for a non-IGDB cover, so no srcSet attribute is emitted', () => {
        expect(coverSrcSetProps('https://assets.isthereanydeal.com/boxart/abc.jpg', '40px')).toEqual({});
    });
});

describe('COVER_INTRINSIC', () => {
    it('matches the t_cover_big rendition the API stores', () => {
        expect(COVER_INTRINSIC).toEqual({ width: 264, height: 374 });
    });
});

const SCREENSHOT = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/sc6abc.jpg';

describe('screenshotSrcSetProps', () => {
    it('offers the med, big and huge screenshot renditions with their true widths', () => {
        expect(screenshotSrcSetProps(SCREENSHOT, '256px')).toEqual({
            srcSet:
                'https://images.igdb.com/igdb/image/upload/t_screenshot_med/sc6abc.jpg 569w, ' +
                'https://images.igdb.com/igdb/image/upload/t_screenshot_big/sc6abc.jpg 889w, ' +
                'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/sc6abc.jpg 1280w',
            sizes: '256px',
        });
    });

    it('never offers a portrait cover rendition for a landscape screenshot', () => {
        const props = screenshotSrcSetProps(SCREENSHOT, '256px');
        expect('srcSet' in props && props.srcSet).not.toMatch(/t_cover_/);
    });

    it.each([
        ['ITAD asset', 'https://assets.isthereanydeal.com/screenshot/abc.jpg'],
        ['Steam CDN', 'https://cdn.akamai.steamstatic.com/steam/apps/1/ss_1.jpg'],
        ['null', null],
    ])('spreads to nothing for a non-IGDB screenshot (%s)', (_label, url) => {
        expect(screenshotSrcSetProps(url, '256px')).toEqual({});
    });
});

describe('SCREENSHOT_INTRINSIC', () => {
    it('matches the t_screenshot_big rendition the API stores', () => {
        expect(SCREENSHOT_INTRINSIC).toEqual({ width: 889, height: 500 });
    });
});
