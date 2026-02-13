import { useAuth } from '../../hooks/use-auth';
import { GameTimePanel } from '../../components/features/game-time';

export function ProfileGameTimePanel() {
    const { isAuthenticated } = useAuth();

    return (
        <div className="space-y-6">
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <GameTimePanel mode="profile" rolling enabled={isAuthenticated} />
            </div>
        </div>
    );
}
