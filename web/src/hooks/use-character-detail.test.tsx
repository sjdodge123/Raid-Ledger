/**
 * ROK-1760 — the character query polls while addon equipment is still
 * `resolved:false`, stops once it resolves, and gives up after the cap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { CharacterDto, EquipmentItemDto } from '@raid-ledger/contract';
import { server } from '../test/mocks/server';
import { createTestQueryClient } from '../test/render-helpers';
import { useCharacterDetail } from './use-character-detail';
import { UNRESOLVED_POLL_MAX_MS, UNRESOLVED_POLL_MAX_TRIES, UNRESOLVED_POLL_MS, resetUnresolvedEquipmentPoll } from './unresolved-equipment-poll';

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const URL = `http://localhost:3000/characters/${CHARACTER_ID}`;
const STAMP = '2026-10-10T00:00:00.000Z';

function item(overrides: Partial<EquipmentItemDto> = {}): EquipmentItemDto {
    return { slot: 'SHIRT', name: "Recruit's Shirt", itemId: 6120, quality: 'COMMON', itemLevel: 1, itemSubclass: null, enchantments: [], sockets: [], ...overrides };
}

function character(items: EquipmentItemDto[]): CharacterDto {
    return {
        id: CHARACTER_ID, userId: 1, gameId: 1, name: 'Ana', realm: null, class: null, spec: null, role: null, roleOverride: null,
        effectiveRole: null, isMain: true, itemLevel: null, externalId: null, avatarUrl: null, renderUrl: null, level: 10, race: null,
        faction: null, lastSyncedAt: null, profileUrl: null, region: null, ruleset: null, gameVariant: null,
        equipment: { equippedItemLevel: null, items, syncedAt: STAMP, source: 'addon' },
        talents: null, professions: null, displayOrder: 0, createdAt: STAMP, updatedAt: STAMP,
    };
}

const UNRESOLVED = character([item({ name: 'Item #6120', resolved: false })]);
const RESOLVED = character([item({ resolved: true, iconUrl: 'https://wow.zamimg.com/i.jpg' })]);

/** Serves `replies` in order (the last one repeats) and counts requests. */
function serve(...replies: CharacterDto[]) {
    const calls = { count: 0 };
    server.use(http.get(URL, () => HttpResponse.json(replies[Math.min(calls.count++, replies.length - 1)])));
    return calls;
}

function renderDetail() {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return { queryClient, ...renderHook(() => useCharacterDetail(CHARACTER_ID), { wrapper }) };
}

async function advance(ms: number) {
    await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe('useCharacterDetail — unresolved equipment polling (ROK-1760)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        resetUnresolvedEquipmentPoll();
    });
    afterEach(() => vi.useRealTimers());

    it('refetches until the item resolves, then shows the resolved name without a reload', async () => {
        const calls = serve(UNRESOLVED, RESOLVED);
        const { result } = renderDetail();
        await waitFor(() => expect(result.current.data?.equipment?.items[0]?.name).toBe('Item #6120'));
        await advance(UNRESOLVED_POLL_MS);
        await waitFor(() => expect(result.current.data?.equipment?.items[0]?.name).toBe("Recruit's Shirt"));
        await advance(UNRESOLVED_POLL_MS * 5);
        expect(calls.count).toBe(2);
    });

    it(`stops after ${UNRESOLVED_POLL_MAX_TRIES} refetches when the item never resolves`, async () => {
        const calls = serve(UNRESOLVED);
        renderDetail();
        await waitFor(() => expect(calls.count).toBe(1));
        for (let i = 0; i < UNRESOLVED_POLL_MAX_TRIES + 5; i++) await advance(UNRESOLVED_POLL_MAX_MS);
        expect(calls.count).toBe(1 + UNRESOLVED_POLL_MAX_TRIES);
    });

    it('starts a fresh budget after a reset (an addon import)', async () => {
        const calls = serve(UNRESOLVED);
        const { queryClient } = renderDetail();
        for (let i = 0; i < UNRESOLVED_POLL_MAX_TRIES + 2; i++) await advance(UNRESOLVED_POLL_MAX_MS);
        const exhausted = calls.count;
        expect(exhausted).toBe(1 + UNRESOLVED_POLL_MAX_TRIES);
        resetUnresolvedEquipmentPoll(CHARACTER_ID);
        await act(() => queryClient.invalidateQueries({ queryKey: ['characters', CHARACTER_ID] }));
        // The invalidate fetch opens the episode; polls follow at +3 s and +9 s (widening).
        await advance(UNRESOLVED_POLL_MAX_MS);
        expect(calls.count).toBe(exhausted + 3);
    });

    it('does not poll Armory equipment (no resolved flag)', async () => {
        const calls = serve(character([item()]));
        renderDetail();
        await waitFor(() => expect(calls.count).toBe(1));
        await advance(UNRESOLVED_POLL_MS * 3);
        expect(calls.count).toBe(1);
    });
});
