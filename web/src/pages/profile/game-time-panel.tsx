import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { GameTimePanel } from '../../components/features/game-time';
import { safeReturnPath } from './game-time-return';

/** ROK-1564: "Edit my week" on a scheduling poll lands here with `?return=`. */
function BackToPoll({ to }: { to: string }) {
    return (
        <Link
            to={to}
            data-testid="game-time-return-link"
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
        >
            ← Back to the poll
        </Link>
    );
}

export function ProfileGameTimePanel() {
    const { isAuthenticated } = useAuth();
    const [params] = useSearchParams();
    const returnTo = safeReturnPath(params.get('return'));

    return (
        <div className="space-y-6">
            {returnTo && <BackToPoll to={returnTo} />}
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <GameTimePanel mode="profile" rolling enabled={isAuthenticated} />
            </div>
        </div>
    );
}
