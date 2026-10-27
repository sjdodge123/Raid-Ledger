/** ROK-1969 D6 — the built-in Core plugin owns the shared hub Gallery card (moved from Valheim). */
import { describe, it, expect } from 'vitest';
import { CORE_PLUGIN_ID, GUILD_KINDS, type GuildPage } from '@raid-ledger/contract';
import { gatedHubGameWidgets, getHubGameWidgetRegistrations } from '../hub-game-widgets';
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

describe('core register — "Before next session" note (ROK-1968 D9)', () => {
    it('registers a lazy, members-only, default-on `session-note` card (span 1) at order 15, on every game and kind', () => {
        const reg = getHubGameWidgetRegistrations().find((r) => r.pluginSlug === CORE_PLUGIN_ID && r.widget.id === 'session-note');
        expect(reg?.widget.title).toBe('Before next session');
        expect(reg?.widget.description).toMatch(/checklist/);
        expect(reg?.widget.audience).toBe('members');
        expect(reg?.widget.games).toBeUndefined();
        expect(reg?.widget.kinds).toBeUndefined();
        expect(reg?.widget.order).toBe(15);
        expect(reg?.widget.span).toBe(1);
        expect(reg?.widget.defaultOn).toBe(true);
        expect(reg?.widget.action?.name).toBe('HubSessionNoteAction');
        expect(reg?.widget.useVisible?.name).toBe('useSessionNoteVisible');
    });

    // T-W9 (A-1, Lead check 2026-10-25): `guilds.game_id` is NOT NULL, so every hub carries a slug —
    // the core card must then reach every kind and any game, not just the ones a plugin lists.
    it.each(GUILD_KINDS)('reaches a member on a %s hub of an arbitrary game', (kind) => {
        const page = {
            guild: { id: 9, kind, gameSlug: 'some-other-game' },
            viewer: { role: 'member', canEdit: false, canManageEditors: false },
        } as GuildPage;
        const ids = gatedHubGameWidgets(page, new Set()).map((r) => `${r.pluginSlug}:${r.widget.id}`);
        expect(ids).toContain(`${CORE_PLUGIN_ID}:session-note`);
    });
});
