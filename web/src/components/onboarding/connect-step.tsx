import { useState } from 'react';
import { API_BASE_URL } from '../../lib/config';
import { DiscordIcon } from '../icons/DiscordIcon';

interface ConnectStepProps {
    onNext: () => void;
    onSkip: () => void;
}

/**
 * Step 1: Connect Your Account (ROK-219 redesign).
 * Shows available auth providers. Currently Discord only.
 * Only displayed when user has no linked OAuth account.
 */
export function ConnectStep({ onNext, onSkip }: ConnectStepProps) {
    const [isRedirecting, setIsRedirecting] = useState(false);

    const handleDiscordConnect = () => {
        setIsRedirecting(true);
        window.location.href = `${API_BASE_URL}/auth/discord/link`;
    };

    return (
        <div className="space-y-6">
            <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold text-foreground">Connect Your Account</h2>
                <p className="text-muted mt-2">
                    Link a gaming account to sync your profile, avatar, and friends.
                </p>
            </div>

            <div className="max-w-sm mx-auto space-y-3">
                <button
                    onClick={handleDiscordConnect}
                    disabled={isRedirecting}
                    className="w-full py-3 px-4 bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-3"
                >
                    {isRedirecting ? (
                        <>
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Redirecting to Discord...
                        </>
                    ) : (
                        <>
                            <DiscordIcon className="w-5 h-5" />
                            Connect Discord
                        </>
                    )}
                </button>

                <p className="text-xs text-dim text-center mt-2">
                    You can always link accounts later from your profile settings.
                </p>
            </div>

            {/* Navigation */}
            <div className="flex gap-3 justify-center max-w-sm mx-auto">
                <button
                    type="button"
                    onClick={onSkip}
                    className="flex-1 px-4 py-2.5 bg-panel hover:bg-overlay text-muted rounded-lg transition-colors text-sm"
                >
                    Skip
                </button>
                <button
                    type="button"
                    onClick={onNext}
                    className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors text-sm"
                >
                    Next
                </button>
            </div>
        </div>
    );
}
