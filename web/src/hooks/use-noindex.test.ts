import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { NOINDEX_CONTENT, useNoIndex } from './use-noindex';

const robotsTags = (): HTMLMetaElement[] =>
    Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta[name="robots"]'));

describe('useNoIndex', () => {
    it('adds a noindex, nofollow robots meta while mounted', () => {
        const { unmount } = renderHook(() => useNoIndex());
        expect(robotsTags().map((m) => m.content)).toEqual([NOINDEX_CONTENT]);
        expect(NOINDEX_CONTENT).toBe('noindex, nofollow');
        unmount();
    });

    it('removes the tag on unmount', () => {
        const { unmount } = renderHook(() => useNoIndex());
        unmount();
        expect(robotsTags()).toHaveLength(0);
    });

    it('leaves a robots tag it did not add in place', () => {
        const other = document.createElement('meta');
        other.name = 'robots';
        other.content = 'index';
        document.head.appendChild(other);
        const { unmount } = renderHook(() => useNoIndex());
        unmount();
        expect(robotsTags()).toEqual([other]);
        other.remove();
    });
});
