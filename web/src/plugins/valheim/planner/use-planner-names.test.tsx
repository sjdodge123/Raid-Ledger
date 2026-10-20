/** ROK-1854 Codex r6 — a row's icon keeps the atlas of the response its entry came from. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { JSX } from 'react';
import type { ValheimCatalogIcon, ValheimMapBaseMap, ValheimPlanNode } from '@raid-ledger/contract';
import { recipeCatalogFixture } from '../../../test/mocks/valheim-recipes-handlers';
import { RecipeTreeRow } from './recipe-tree-row';
import { usePlannerNames, type PlannerNameSource } from './use-planner-names';

vi.mock('../hooks/use-valheim-characters', () => ({
    useValheimBlobUrl: (_serverId: number, sha: string | null) => (sha === null ? null : `blob:${sha}`),
}));

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const atlas = (sha256: string): ValheimMapBaseMap => ({ sha256, width: 512, height: 256, ready: true });
const at = (x: number): ValheimCatalogIcon => ({ kind: 'atlas', x, y: 0, w: 64, h: 64 });

const base = recipeCatalogFixture();
const catalog = {
    ...base,
    itemAtlas: atlas(SHA_A),
    entries: [
        ...base.entries,
        { prefab: 'IronScrap', kind: 'item' as const, name: 'Iron scrap', category: 'Material', icon: at(0), maxQuality: 1, sources: { recipes: 0, processes: 0 } },
    ],
};
const tree: PlannerNameSource = {
    items: { IronScrap: { name: 'Iron scrap', category: 'Material', icon: at(64) } },
    itemAtlas: atlas(SHA_B),
};
const node: ValheimPlanNode = {
    id: 0, parentId: null, prefab: 'IronScrap', quantity: 1, via: { type: 'gathered' }, alternatives: 0, crafts: 0, have: null, short: null,
};

function Harness(): JSX.Element {
    const names = usePlannerNames(7, catalog, undefined, tree, 'tree');
    return <RecipeTreeRow node={node} kind="item" names={names} hasChildren={false} expanded={false} onToggle={() => undefined} />;
}

afterEach(() => vi.unstubAllGlobals());

describe('usePlannerNames icon pairing', () => {
    it('a tree row draws its tree entry from the tree atlas, not the catalogue atlas', async () => {
        vi.stubGlobal('Image', class { src = ''; decode = (): Promise<void> => Promise.resolve(); });
        const { container } = render(<Harness />);
        await act(async () => {
            await Promise.resolve();
        });
        const sprite = container.querySelector<HTMLElement>('[data-face="sprite"]');
        expect(sprite?.style.backgroundImage).toBe(`url("blob:${SHA_B}")`);
        // (64,0) on a 64px cell scaled to the 32px tile → −32px; the catalogue's (0,0) would be 0px.
        expect(sprite?.style.backgroundPosition).toBe('-32px 0px');
    });
});
