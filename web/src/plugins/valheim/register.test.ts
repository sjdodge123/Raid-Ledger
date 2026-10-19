/** ROK-1837 — the Map tab is registered on Valheim server hubs through the ROK-1831 seam. */
import { describe, it, expect } from 'vitest';
import { serverHubGameTabs } from '../pelican/hub/server-hub-game-tabs';
import './register';

describe('valheim register — hub Map tab', () => {
    it('registers a lazy `map` tab for valheim server hubs', () => {
        const tab = serverHubGameTabs().find((t) => t.id === 'map');
        expect(tab).toBeDefined();
        expect(tab?.label).toBe('Map');
        expect(tab?.order).toBe(20);
        expect(tab?.component.name).toBe('LazyValheimMapHubTab');
    });
});
