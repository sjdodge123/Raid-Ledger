/** ROK-1969 D6 — the built-in Core plugin owns the shared hub Gallery card (moved from Valheim). */
import { describe, it, expect } from 'vitest';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { getHubGameWidgetRegistrations } from '../hub-game-widgets';
import { getPluginBadge } from '../plugin-registry';
import './register';
import '../valheim/register';

describe('core register — Overview Gallery widget (ROK-1942 D10, moved by ROK-1969 D6)', () => {
    it('registers a lazy, members-only, default-on `gallery` card (span 2) right after Deaths, owned by core', () => {
        const reg = getHubGameWidgetRegistrations().find((r) => r.pluginSlug === CORE_PLUGIN_ID && r.widget.id === 'gallery');
        expect(reg?.widget.title).toBe('Gallery');
        expect(reg?.widget.description).toMatch(/pictures/);
        expect(reg?.widget.audience).toBe('members');
        // Behaviour-neutral move: still Valheim server hubs only until ROK-1965 widens it.
        expect(reg?.widget.kinds).toEqual(['game_server']);
        expect(reg?.widget.games).toEqual(['valheim']);
        expect(reg?.widget.order).toBe(47);
        expect(reg?.widget.span).toBe(2);
        expect(reg?.widget.defaultOn).toBe(true);
        expect(reg?.widget.action?.name).toBe('HubGallerySeeAll');
        expect(reg?.widget.useVisible?.name).toBe('useGalleryWidgetVisible');
    });

    it('the Valheim plugin no longer registers a Gallery of its own', () => {
        const owners = getHubGameWidgetRegistrations().filter((r) => r.widget.id === 'gallery').map((r) => r.pluginSlug);
        expect(owners).toEqual([CORE_PLUGIN_ID]);
    });

    it('registers a "Core" badge, so arrange mode labels plugin:core:* as Core', () => {
        expect(getPluginBadge(CORE_PLUGIN_ID)?.label).toBe('Core');
    });
});
