/**
 * Watched Games panel with auto-heart toggle (ROK-548).
 */
import { MyWatchedGamesSection } from '../../components/profile/my-watched-games-section';
import { AutoHeartToggle } from './identity-sections';
import { useAutoHeart } from './identity-hooks';
import { useAuth } from '../../hooks/use-auth';
import { isDiscordLinked } from '../../lib/avatar';

export function WatchedGamesPanel() {
    const { user, isAuthenticated } = useAuth();
    const hasDiscord = isDiscordLinked(user?.discordId ?? null);
    const autoHeart = useAutoHeart(isAuthenticated, hasDiscord);

    return (
        <div className="space-y-6 pb-8">
            <MyWatchedGamesSection />
            {hasDiscord && (
                <AutoHeartToggle
                    enabled={autoHeart.autoHeartEnabled}
                    onToggle={autoHeart.toggleAutoHeart}
                    isPending={autoHeart.isPending}
                />
            )}
        </div>
    );
}
