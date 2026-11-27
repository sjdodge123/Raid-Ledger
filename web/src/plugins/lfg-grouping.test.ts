import { afterEach, describe, expect, it } from 'vitest';
import { clearRegistry, registerPlugin } from './plugin-registry';
import { getLfgGroupingRegistrations, resolveLfgGrouping } from './lfg-grouping';

const badge = { icon: 'x', color: 'blue', label: 'X' };

afterEach(() => clearRegistry());

describe('registerLfgGrouping', () => {
    it('records the owner and replaces a re-registered id', () => {
        const handle = registerPlugin('blizzard', badge);
        handle.registerLfgGrouping({ id: 'wow-instance-lfg', gameSlugs: ['world-of-warcraft'] });
        handle.registerLfgGrouping({ id: 'wow-instance-lfg', gameSlugs: ['world-of-warcraft-classic'] });
        expect(getLfgGroupingRegistrations()).toEqual([
            { pluginSlug: 'blizzard', grouping: { id: 'wow-instance-lfg', gameSlugs: ['world-of-warcraft-classic'] } },
        ]);
    });

    it('is cleared with the rest of the registry', () => {
        registerPlugin('blizzard', badge).registerLfgGrouping({ id: 'g', gameSlugs: ['wow'] });
        clearRegistry();
        expect(getLfgGroupingRegistrations()).toEqual([]);
    });
});

describe('resolveLfgGrouping — gating', () => {
    it('returns the grouping only while its plugin is active and the slug matches', () => {
        registerPlugin('blizzard', badge).registerLfgGrouping({ id: 'g', gameSlugs: ['wow'] });
        expect(resolveLfgGrouping('wow', new Set(['core', 'blizzard']))?.id).toBe('g');
        expect(resolveLfgGrouping('wow', new Set(['core']))).toBeNull();
        expect(resolveLfgGrouping('valheim', new Set(['core', 'blizzard']))).toBeNull();
        expect(resolveLfgGrouping(undefined, new Set(['blizzard']))).toBeNull();
    });
});
