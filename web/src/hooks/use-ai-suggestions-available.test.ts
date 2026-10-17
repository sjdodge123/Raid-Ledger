/**
 * Pins the ROK-1317 contract for the combined AI-surfaces gate.
 *
 * Non-admin users have the `useAiFeatures` query disabled, so its `data`
 * is `undefined` — the gate must still report AI as available. Only an
 * explicit `aiSuggestionsEnabled === false` (admin toggle) disables the
 * surfaces, and an inactive plugin always gates everything off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./admin/use-ai-settings', () => ({ useAiFeatures: vi.fn() }));

import { useAiFeatures } from './admin/use-ai-settings';
import { usePluginStore } from '../stores/plugin-store';
import { useAiSuggestionsAvailable } from './use-ai-suggestions-available';

const mockUseAiFeatures = vi.mocked(useAiFeatures);

function mockFeatures(data: { aiSuggestionsEnabled: boolean } | undefined) {
    mockUseAiFeatures.mockReturnValue({ data } as unknown as ReturnType<
        typeof useAiFeatures
    >);
}

describe('useAiSuggestionsAvailable', () => {
    beforeEach(() => {
        usePluginStore.getState().setActiveSlugs(['ai']);
    });

    it('returns true when the plugin is active and features are undefined (non-admin)', () => {
        mockFeatures(undefined);
        const { result } = renderHook(() => useAiSuggestionsAvailable());
        expect(result.current).toBe(true);
    });

    it('returns false when the admin toggle is explicitly disabled', () => {
        mockFeatures({ aiSuggestionsEnabled: false });
        const { result } = renderHook(() => useAiSuggestionsAvailable());
        expect(result.current).toBe(false);
    });

    it('returns false when the AI plugin is inactive, regardless of features', () => {
        usePluginStore.getState().setActiveSlugs([]);
        mockFeatures(undefined);
        const { result } = renderHook(() => useAiSuggestionsAvailable());
        expect(result.current).toBe(false);
    });
});
