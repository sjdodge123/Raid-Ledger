import { useSearchParams } from 'react-router-dom';
import { SteamIcon } from '../icons/SteamIcon';
import { useSteamLink } from '../../hooks/use-steam-link';

/** Header with Steam icon in emerald circle and title. */
function SteamStepHeader() {
    return (
        <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <SteamIcon className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Connect Your Steam Account</h2>
            <p className="text-muted mt-2">
                Connect Steam to see which games your community owns, get price alerts, and power game night picks.
            </p>
        </div>
    );
}

/**
 * Primary "Connect Steam" button. ROK-1630: a real <button>, not an <a href> —
 * the Steam hop needs a single-use nonce minted on click, so there is no URL
 * to render up front. Same classes as the old link, so it looks identical.
 */
function ConnectSteamButton({ isRedirecting, onClick }: { isRedirecting: boolean; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} disabled={isRedirecting} aria-busy={isRedirecting}
            className="w-full py-3 px-4 min-h-[44px] bg-[#171a21] hover:bg-[#2a475e] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-3">
            {isRedirecting ? (
                <><span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Redirecting to Steam...</>
            ) : (
                <><SteamIcon className="w-5 h-5" />Connect Steam</>
            )}
        </button>
    );
}

/** Success feedback shown after returning from Steam auth. */
function SteamSuccessMessage() {
    return (
        <div className="flex items-center gap-2 justify-center text-emerald-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Steam connected!</span>
        </div>
    );
}

/** Error feedback with retry button shown after a failed Steam auth. */
function SteamErrorMessage({ message, onRetry }: { message: string | null; onRetry: () => void }) {
    return (
        <div className="space-y-3 text-center">
            <p className="text-red-400 text-sm">{message || 'Something went wrong connecting Steam. Please try again.'}</p>
            <button onClick={onRetry}
                className="px-4 py-2 min-h-[44px] bg-[#171a21] hover:bg-[#2a475e] text-white font-semibold rounded-lg transition-colors text-sm">
                Retry
            </button>
        </div>
    );
}

/**
 * Onboarding wizard step for connecting a Steam account (ROK-941).
 * Shows a connect link/button, success/error states based on URL params,
 * and a footer note about linking later.
 */
export function SteamStep() {
    const [searchParams] = useSearchParams();
    const { linkSteam, isLinkPending } = useSteamLink();

    const steamResult = searchParams.get('steam');
    const isSuccess = steamResult === 'success';
    const isError = steamResult === 'error';

    const handleConnect = () => { void linkSteam('/onboarding'); };

    return (
        <div className="space-y-6">
            <SteamStepHeader />
            <div className="max-w-sm mx-auto space-y-3">
                {isSuccess && <SteamSuccessMessage />}
                {isError && <SteamErrorMessage message={searchParams.get('message')} onRetry={handleConnect} />}
                {!isSuccess && !isError && (
                    <ConnectSteamButton isRedirecting={isLinkPending} onClick={handleConnect} />
                )}
                <p className="text-xs text-dim text-center mt-2">
                    You can always link accounts later from your profile settings.
                </p>
            </div>
        </div>
    );
}
