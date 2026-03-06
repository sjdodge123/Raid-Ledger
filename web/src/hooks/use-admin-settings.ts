/**
 * Composite hook for admin settings API operations.
 * Delegates to focused sub-hooks for each integration domain.
 */

// Re-export types for backward compatibility
export type {
    DemoDataCounts,
    DemoDataStatus,
    DemoDataResult,
} from './admin/admin-settings-types';

import { useOAuthSettings } from './admin/use-oauth-settings';
import { useIgdbSettings } from './admin/use-igdb-settings';
import { useBlizzardSettings } from './admin/use-blizzard-settings';
import { useDiscordBotSettings } from './admin/use-discord-bot-settings';
import { useMiscSettings } from './admin/use-misc-settings';

/**
 * Hook for admin settings API operations.
 * Composes individual domain hooks into a single return object.
 */
export function useAdminSettings() {
    const oauth = useOAuthSettings();
    const igdb = useIgdbSettings();
    const blizzard = useBlizzardSettings();
    const discord = useDiscordBotSettings();
    const misc = useMiscSettings();

    return {
        ...oauth,
        ...igdb,
        ...blizzard,
        ...discord,
        ...misc,
    };
}
