import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePluginStore } from '../stores/plugin-store';
import { clearRegistry, registerPlugin } from './plugin-registry';
import { useEventReportLinksSupported } from './event-report-links';

const BADGE = { icon: '/x.svg', color: '#000', label: 'X' };

function supported(slug: string | null): boolean {
    return renderHook(() => useEventReportLinksSupported(slug)).result.current;
}

describe('event report-link host API', () => {
    beforeEach(() => {
        clearRegistry();
        usePluginStore.setState({ activeSlugs: new Set<string>() });
    });

    it('is true only while the declaring plugin is active and claims the game', () => {
        registerPlugin('logs', BADGE).registerEventReportLinks((slug) => slug === 'game-a');
        expect(supported('game-a')).toBe(false);
        usePluginStore.setState({ activeSlugs: new Set(['logs']) });
        expect(supported('game-a')).toBe(true);
        expect(supported('game-b')).toBe(false);
        expect(supported(null)).toBe(false);
    });

    it('clearRegistry empties the declarations', () => {
        registerPlugin('logs', BADGE).registerEventReportLinks(() => true);
        usePluginStore.setState({ activeSlugs: new Set(['logs']) });
        clearRegistry();
        expect(supported('game-a')).toBe(false);
    });

    it('re-registering (HMR) replaces the predicate instead of adding a second one', () => {
        registerPlugin('logs', BADGE).registerEventReportLinks(() => true);
        registerPlugin('logs', BADGE).registerEventReportLinks((slug) => slug === 'game-b');
        usePluginStore.setState({ activeSlugs: new Set(['logs']) });
        expect(supported('game-a')).toBe(false);
        expect(supported('game-b')).toBe(true);
    });
});
