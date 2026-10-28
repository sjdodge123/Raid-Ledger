import { describe, it, expect, afterEach } from 'vitest';
import { useHubGalleryStore, type HubGalleryOpenRequest } from './hub-gallery-store';

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
