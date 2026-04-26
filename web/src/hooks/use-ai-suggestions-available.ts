/**
 * Combined gate for the AI nomination suggestions surface (ROK-1114).
 *
 * Returns `true` only when BOTH:
 *   1. The AI plugin is currently active (admin has installed it), AND
 *   2. The `ai_suggestions_enabled` admin toggle is not explicitly false.
 *
 * Used by every AI surface — the modal row, the CommonGround banner,
 * the ✨ AI Pick badges, the React Query `enabled` flag on
 * `useAiSuggestions`, and the lineup-detail prefetch — so an
 * uninstalled plugin or admin disable hides the entire feature with
 * no banners, badges, headers, skeletons or fetches.
 *
 * The `aiSuggestionsEnabled` field defaults to `true` server-side, so
 * `undefined` (loading) is treated as enabled to avoid first-render
 * flicker. This is consistent with how the rest of the AI surfaces
 * have always rendered before the toggle existed.
 */
import { useAiFeatures } from './admin/use-ai-settings';
import { usePluginStore } from '../stores/plugin-store';

export function useAiSuggestionsAvailable(): boolean {
    const pluginActive = usePluginStore((s) => s.isPluginActive('ai'));
    const { data } = useAiFeatures();
    if (!pluginActive) return false;
    // Treat undefined (loading / unauthenticated) as enabled so we don't
    // hide AI on first render. The server defaults this to true and only
    // an explicit `false` disables the feature.
    return data?.aiSuggestionsEnabled !== false;
}
