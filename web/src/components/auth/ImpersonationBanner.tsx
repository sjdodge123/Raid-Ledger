import { useAuth } from '../../hooks/use-auth';
import './ImpersonationBanner.css';

/**
 * Sticky banner shown when an admin is impersonating another user.
 * Displays at the very top of the page above all other content.
 */
export function ImpersonationBanner() {
    const { user, isImpersonating, exitImpersonation } = useAuth();

    if (!isImpersonating || !user) {
        return null;
    }

    const handleExit = async () => {
        await exitImpersonation();
    };

    return (
        <>
            <div className="impersonation-banner">
                <div className="impersonation-banner__content">
                    <span className="impersonation-banner__icon">⚠️</span>
                    <span className="impersonation-banner__text">
                        Viewing as <strong>{user.username}</strong>
                    </span>
                    <button
                        onClick={handleExit}
                        className="impersonation-banner__exit"
                    >
                        Exit Impersonation
                    </button>
                </div>
            </div>
            {/* Spacer to offset fixed banner height */}
            <div className="impersonation-banner__spacer" />
        </>
    );
}
