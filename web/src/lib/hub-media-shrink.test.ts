import { describe, it, expect } from 'vitest';
import { mayHaveAlpha } from './hub-media-shrink';

describe('mayHaveAlpha', () => {
    it('treats PNG and WebP as possibly transparent and JPEG as opaque', () => {
        expect(mayHaveAlpha(new File(['a'], 'a.png', { type: 'image/png' }))).toBe(true);
        expect(mayHaveAlpha(new File(['a'], 'a.webp', { type: 'image/webp' }))).toBe(true);
        expect(mayHaveAlpha(new File(['a'], 'a.jpg', { type: 'image/jpeg' }))).toBe(false);
    });
});
