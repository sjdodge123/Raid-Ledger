import { describe, it, expect, beforeEach } from 'vitest';
import { GgEventsCardSchema, GgHubsCardSchema, type GgCardEnvelope } from '@raid-ledger/contract';
import { addGgCard, clearGgCards, getGgCardRegistrations, resolveGgCards, type GgCardRegistration } from './gg-cards';

const Null = (): null => null;
const card = (id: string, schema: GgCardRegistration['schema'], order = 10): GgCardRegistration =>
    ({ id, label: id, order, schema, Component: Null });
const env = (pluginSlug: string, cardId: string, order: number, payload: unknown): GgCardEnvelope =>
    ({ pluginSlug, cardId, order, payload });
const events = { signedUp: 3, attended: 2, noShows: 0, firstEventAt: null, lastEventAt: null };

describe('GG card registry (ROK-2187)', () => {
    beforeEach(() => {
        clearGgCards();
        addGgCard('core', card('events', GgEventsCardSchema));
        addGgCard('core', card('hubs', GgHubsCardSchema));
        addGgCard('valheim', card('valheim-year', GgHubsCardSchema));
    });

    it('keeps the owner of every registration', () => {
        expect(getGgCardRegistrations().map((r) => `${r.pluginSlug}:${r.card.id}`))
            .toEqual(['core:events', 'core:hubs', 'valheim:valheim-year']);
    });

    it('resolves stored cards in envelope order with their parsed payload', () => {
        const out = resolveGgCards([env('core', 'hubs', 20, { joined: 1, posts: 2, pictures: 0 }), env('core', 'events', 5, events)], new Set(['core']));
        expect(out.map((c) => c.key)).toEqual(['core:events', 'core:hubs']);
        expect(out[0]?.payload).toEqual(events);
    });

    it('skips an unknown card, a payload that fails its schema, and an inactive plugin card', () => {
        const out = resolveGgCards([
            env('core', 'events', 1, { signedUp: -1 }),
            env('core', 'mystery', 2, {}),
            env('valheim', 'valheim-year', 3, { joined: 1, posts: 0, pictures: 0 }),
            env('core', 'hubs', 4, { joined: 1, posts: 0, pictures: 0 }),
        ], new Set(['core']));
        expect(out.map((c) => c.key)).toEqual(['core:hubs']);
    });

    it('renders an active plugin card', () => {
        const out = resolveGgCards([env('valheim', 'valheim-year', 3, { joined: 1, posts: 0, pictures: 0 })], new Set(['core', 'valheim']));
        expect(out.map((c) => c.key)).toEqual(['valheim:valheim-year']);
    });
});
