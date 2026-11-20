import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePluginStore } from '../stores/plugin-store';
import { clearRegistry, registerPlugin } from './plugin-registry';
import { useAdminGeneralNavItems } from './admin-nav-items';

const BADGE = { icon: '/x.svg', color: '#000', label: 'X' };
const ROW_A = { to: '/admin/settings/general/a', label: 'A' };
const ROW_B = { to: '/admin/settings/general/b', label: 'B' };

function navItems(): readonly { to: string; label: string }[] {
    return renderHook(() => useAdminGeneralNavItems()).result.current;
}

describe('admin General nav-item host API', () => {
    beforeEach(() => {
        clearRegistry();
        usePluginStore.setState({ activeSlugs: new Set<string>() });
    });

    it('returns a plugin\'s rows only while that plugin is active', () => {
        registerPlugin('alpha', BADGE).registerAdminGeneralNavItems([ROW_A]);
        registerPlugin('beta', BADGE).registerAdminGeneralNavItems([ROW_B]);
        expect(navItems()).toEqual([]);
        usePluginStore.setState({ activeSlugs: new Set(['beta']) });
        expect(navItems()).toEqual([ROW_B]);
        usePluginStore.setState({ activeSlugs: new Set(['alpha', 'beta']) });
        expect(navItems()).toEqual([ROW_A, ROW_B]);
    });

    it('clearRegistry empties the declarations', () => {
        registerPlugin('alpha', BADGE).registerAdminGeneralNavItems([ROW_A]);
        usePluginStore.setState({ activeSlugs: new Set(['alpha']) });
        clearRegistry();
        expect(navItems()).toEqual([]);
    });

    it('re-registering (HMR) replaces the rows instead of adding a second set', () => {
        registerPlugin('alpha', BADGE).registerAdminGeneralNavItems([ROW_A]);
        registerPlugin('alpha', BADGE).registerAdminGeneralNavItems([ROW_B]);
        usePluginStore.setState({ activeSlugs: new Set(['alpha']) });
        expect(navItems()).toEqual([ROW_B]);
    });
});
