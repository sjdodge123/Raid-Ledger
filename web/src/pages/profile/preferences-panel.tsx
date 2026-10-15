/**
 * Consolidated Preferences panel (ROK-359, ROK-548).
 * Includes Appearance, Timezone, and the AutoHeart + auto game roles toggles.
 */
import { AppearancePanel } from './appearance-panel';
import { TimezoneSection } from '../../components/profile/TimezoneSection';
import { AutoHeartToggle } from './identity-sections';
import { GameRolesOptOutToggle } from './game-roles-opt-out-toggle';
import { useAutoHeart, useGameRolesOptOut } from './identity-hooks';
import { useAuth } from '../../hooks/use-auth';
import { isDiscordLinked } from '../../lib/avatar';

export function PreferencesPanel() {
    const { user, isAuthenticated } = useAuth();
    const hasDiscord = isDiscordLinked(user?.discordId ?? null);
    const autoHeart = useAutoHeart(isAuthenticated, hasDiscord);
    const gameRoles = useGameRolesOptOut(isAuthenticated, hasDiscord);

    return (
        <div className="space-y-6 pb-8">
            <AppearancePanel />
            <TimezoneSection />
            {hasDiscord && (
                <>
                    <AutoHeartToggle
                        enabled={autoHeart.autoHeartEnabled}
                        onToggle={autoHeart.toggleAutoHeart}
                        isPending={autoHeart.isPending}
                    />
                    <GameRolesOptOutToggle
                        enabled={gameRoles.gameRolesEnabled}
                        onToggle={gameRoles.toggleGameRoles}
                        isPending={gameRoles.isPending}
                    />
                </>
            )}
        </div>
    );
}
