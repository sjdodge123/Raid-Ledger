import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EventResponseDto } from '@raid-ledger/contract';
import { useCalendarImageHints } from './use-calendar-image-hints';

/** Captures every `new Image().src = …` the hook issues. */
const kicked: string[] = [];
const RealImage = globalThis.Image;

class FakeImage {
    private _src = '';
    get src() { return this._src; }
    set src(value: string) { this._src = value; kicked.push(value); }
}

function hrefs(rel: string): string[] {
    return Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`))
        .map((link) => link.getAttribute('href') ?? '');
}

function makeEvent(id: number, coverUrl: string | null, avatars: Array<{ id: number; discordId: string; avatar: string | null }> = []): { resource: EventResponseDto } {
    return {
        resource: {
            id,
            title: `Event ${id}`,
            game: { id: 7, name: 'Game', slug: 'game', coverUrl },
            signupsPreview: avatars.map((a) => ({ ...a, username: `u${a.id}` })),
        } as unknown as EventResponseDto,
    };
}

describe('useCalendarImageHints (ROK-1482)', () => {
    beforeEach(() => {
        kicked.length = 0;
        document.head.querySelectorAll('link').forEach((link) => link.remove());
        globalThis.Image = FakeImage as unknown as typeof Image;
    });
    afterEach(() => { globalThis.Image = RealImage; });

    it('emits preconnect + dns-prefetch hints for the IGDB and Discord CDN origins on mount', () => {
        renderHook(() => useCalendarImageHints([]));
        expect(hrefs('preconnect')).toEqual(['https://images.igdb.com', 'https://cdn.discordapp.com']);
        expect(hrefs('dns-prefetch')).toEqual(['https://images.igdb.com', 'https://cdn.discordapp.com']);
    });

    it('does not duplicate a hint that is already in <head>', () => {
        const existing = document.createElement('link');
        existing.rel = 'preconnect';
        existing.href = 'https://images.igdb.com';
        document.head.appendChild(existing);
        renderHook(() => useCalendarImageHints([]));
        expect(hrefs('preconnect')).toEqual(['https://images.igdb.com', 'https://cdn.discordapp.com']);
    });

    it('prefetches each unique cover and avatar exactly once when events arrive', () => {
        const cover = 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg';
        const events = [
            makeEvent(1, cover, [{ id: 10, discordId: '111', avatar: 'hash1' }]),
            makeEvent(2, cover, [{ id: 10, discordId: '111', avatar: 'hash1' }, { id: 11, discordId: '222', avatar: null }]),
            makeEvent(3, null),
        ];
        const { rerender } = renderHook(({ list }) => useCalendarImageHints(list), { initialProps: { list: events } });
        expect(kicked).toEqual([cover, 'https://cdn.discordapp.com/avatars/111/hash1.png']);

        // A refetch hands back a new array with the same URLs: nothing is kicked twice.
        rerender({ list: [...events] });
        expect(kicked).toHaveLength(2);
    });

    it('adds hints for cover origins discovered in the response (e.g. ITAD boxart)', () => {
        renderHook(() => useCalendarImageHints([makeEvent(1, 'https://assets.isthereanydeal.com/boxart/x.jpg')]));
        expect(hrefs('preconnect')).toContain('https://assets.isthereanydeal.com');
    });

    it('caps eager prefetch at 40 images', () => {
        const events = Array.from({ length: 60 }, (_, i) => makeEvent(i, `https://images.igdb.com/c/${i}.jpg`));
        renderHook(() => useCalendarImageHints(events));
        expect(kicked).toHaveLength(40);
    });
});
