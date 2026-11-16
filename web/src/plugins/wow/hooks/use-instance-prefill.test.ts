/**
 * ROK-2215 W4 — a plan link's dungeon id resolves against the game's DUNGEON
 * list only, byte-identical to what a manual tick in the content browser makes.
 */
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { WowInstanceDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { buildBasicInstanceDetail } from '../lib/instance-detail';
import { useInstancePrefill } from './use-instance-prefill';

const INSTANCES_URL = 'http://localhost:3000/blizzard/instances';
const DUNGEON: WowInstanceDto = { id: 90000004, name: 'Wailing Caverns', shortName: 'WC', expansion: 'Classic', minimumLevel: 15, maximumLevel: 25 };
const RAID: WowInstanceDto = { id: 90000100, name: 'Molten Core', expansion: 'Classic', minimumLevel: 60, maximumLevel: 60 };

/** Serves DUNGEON for `type=dungeon` and RAID for `type=raid`. */
function serveLists(): void {
    server.use(http.get(INSTANCES_URL, ({ request }) => {
        const type = new URL(request.url).searchParams.get('type');
        return HttpResponse.json({ data: type === 'raid' ? [RAID] : [DUNGEON] });
    }));
}

function run(slug: string | null, ids: number[]) {
    const qc = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    return renderHook(() => useInstancePrefill(slug, ids), { wrapper });
}

describe('useInstancePrefill (W4)', () => {
    it('resolves a listed dungeon id and drops an unknown one', async () => {
        serveLists();
        const { result } = run(WOW_FOREVER_GAME_SLUG, [90000004, 999]);
        await waitFor(() => expect(result.current.instances).toHaveLength(1));
        expect(result.current.instances).toEqual([buildBasicInstanceDetail(DUNGEON, 'dungeon')]);
        expect(result.current.instances[0]?.category).toBe('dungeon');
        expect(result.current.isLoading).toBe(false);
    });

    it('drops a raid id (only the dungeon list is read)', async () => {
        serveLists();
        const { result } = run(WOW_FOREVER_GAME_SLUG, [RAID.id]);
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.instances).toEqual([]);
    });

    it('stays idle for a non-WoW game or no ids', () => {
        expect(run('valheim', [90000004]).result.current).toEqual({ instances: [], isLoading: false });
        expect(run(WOW_FOREVER_GAME_SLUG, []).result.current).toEqual({ instances: [], isLoading: false });
    });
});
