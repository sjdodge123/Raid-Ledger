import { describe, it, expect, afterEach } from 'vitest';
import { isSameOriginApiPath, openHubPicture, useHubGalleryStore, type HubGalleryOpenRequest } from './hub-gallery-store';

describe('hub gallery store subject (ROK-2027)', () => {
    afterEach(() => useHubGalleryStore.getState().closeGallery());

    it('openGallery keeps the subject; it never touches the per-hub card filter (D10)', () => {
        const request: HubGalleryOpenRequest = {
            guildId: 7, mode: 'grid', filter: 'death', index: 0, returnFocus: null,
            subject: { id: 'valheim-death:c42', label: 'Callahan' },
        };
        useHubGalleryStore.getState().openGallery(request);
        expect(useHubGalleryStore.getState().request?.subject).toEqual({ id: 'valheim-death:c42', label: 'Callahan' });
        expect(useHubGalleryStore.getState().filters[7]).toBeUndefined();
    });
});

describe('openHubPicture authed url guard (ROK-2074 review)', () => {
    afterEach(() => useHubGalleryStore.getState().closeGallery());

    it('accepts only a same-origin API path', () => {
        expect(['/plugins/bg3/hubs/1/thumb.webp', '/a'].map(isSameOriginApiPath)).toEqual([true, true]);
        const refused = ['//evil.example/x', '/\\evil.example/x', '\\\\evil.example', '@evil.example/x', 'https://evil.example/x', 'x', ''];
        expect(refused.filter(isSameOriginApiPath)).toEqual([]);
    });

    it('opens an authed same-origin path in the single-picture viewer', () => {
        openHubPicture(3, { url: '/hubs/3/shot.webp', alt: 'Shot', auth: true }, null);
        expect(useHubGalleryStore.getState().request?.single).toEqual({ url: '/hubs/3/shot.webp', alt: 'Shot', auth: true });
    });

    it('never opens (so never sends the token for) an authed off-origin url', () => {
        openHubPicture(3, { url: '//evil.example/steal', alt: 'Shot', auth: true }, null);
        openHubPicture(3, { url: '@evil.example/steal', alt: 'Shot', auth: true }, null);
        expect(useHubGalleryStore.getState().request).toBeNull();
    });

    it('still opens an unauthed absolute url (a public crest asset; no token)', () => {
        openHubPicture(3, { url: 'https://cdn.example/crest.webp', alt: 'Crest' }, null);
        expect(useHubGalleryStore.getState().request?.single?.url).toBe('https://cdn.example/crest.webp');
    });
});
