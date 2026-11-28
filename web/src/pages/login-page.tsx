import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, type User } from '../hooks/use-auth';
import { useSystemStatus } from '../hooks/use-system-status';
import { API_BASE_URL } from '../lib/config';
import { toast } from '../lib/toast';
import { consumeAuthRedirect } from '../components/auth';
import { setAuthMethod, clearSilentGuard } from '../lib/api/silent-reauth';
import type { LoginMethodDto } from '@raid-ledger/contract';
import { LoginBody } from './login/LoginBody';
import { oauthErrorMessage } from './login/oauth-error-message';
import { nativeFetch } from '../lib/api/native-fetch';
import { safeGetItem, safeSetItem } from '../lib/safe-storage';
import { recordLastSignin } from '../lib/last-signin';

/**
 * Watches for an OAuth refusal (`?error=…&reason=…`) and toasts it. ROK-313
 * AC4: banned/kicked land here from Discord OAuth; ROK-1753: a deactivated
 * session; ROK-2371: the same codes from Google plus `google_unverified`.
 */
function useOAuthErrorHandler(): void {
    const [searchParams, setSearchParams] = useSearchParams();
    useEffect(() => {
        const message = oauthErrorMessage(searchParams.get('error'), searchParams.get('reason'));
        if (!message) return;
        toast.error(message);
        searchParams.delete('error');
        searchParams.delete('reason');
        setSearchParams(searchParams, { replace: true });
    }, [searchParams, setSearchParams]);
}

/** Derives community display info from system status */
function useCommunityInfo(): {
    isFirstRun: boolean; authProviders: LoginMethodDto[];
    communityName: string; communityLogoUrl: string | null; discordSigninCode: boolean;
} {
    const { data: systemStatus } = useSystemStatus();
    const isFirstRun = systemStatus?.isFirstRun ?? false;
    const authProviders: LoginMethodDto[] = systemStatus?.authProviders ?? [];
    const communityName = systemStatus?.communityName || 'Raid Ledger';
    const communityLogoUrl = systemStatus?.communityLogoUrl ? `${API_BASE_URL}${systemStatus.communityLogoUrl}` : null;
    // ROK-2370: the Discord-app code needs the bot online + a guild + a trusted client URL.
    const discordSigninCode = systemStatus?.discordSigninCode ?? false;
    return { isFirstRun, authProviders, communityName, communityLogoUrl, discordSigninCode };
}

/** Redirect logic after successful login */
function handlePostLoginRedirect(
    user: { role?: string; onboardingCompletedAt: string | null },
    isFirstRun: boolean,
    navigate: ReturnType<typeof useNavigate>,
): void {
    const hasSeenWelcome = safeGetItem('rl-welcome-shown');
    if (isFirstRun && !hasSeenWelcome) {
        safeSetItem('rl-welcome-shown', 'true');
        setTimeout(() => toast.info('Welcome! Visit your Profile to add characters.', { duration: 6000 }), 1000);
    }
    if (user.role !== 'admin' && !user.onboardingCompletedAt) {
        toast.success('Welcome! Let\'s get you set up.');
        navigate('/onboarding', { replace: true });
        return;
    }
    navigate(consumeAuthRedirect() || '/calendar', { replace: true });
}

/** Hook encapsulating local login state and handler */
function useLocalLogin(isFirstRun: boolean): {
    isLoading: boolean; error: string | null;
    handleLocalLogin: (username: string, password: string) => Promise<void>;
} {
    const navigate = useNavigate();
    const { login } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLocalLogin = async (username: string, password: string): Promise<void> => {
        setError(null);
        setIsLoading(true);
        try {
            await performLocalLogin({ username, password, login, isFirstRun, navigate });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Login failed';
            setError(message);
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    return { isLoading, error, handleLocalLogin };
}

/** ROK-2370: a Discord-app code sign-in finished — remember the method, then route. */
function useCodeSignedIn(isFirstRun: boolean): (user: User) => void {
    const navigate = useNavigate();
    return useCallback((user: User): void => {
        recordLastSignin('discord-app-code', user);
        handlePostLoginRedirect(user, isFirstRun, navigate);
    }, [isFirstRun, navigate]);
}

/**
 * Login page with pluggable auth providers and local username/password options.
 * When auth providers are configured (e.g. Discord), OAuth is shown prominently
 * with the workarounds (Discord-app code, username/password) behind
 * "Sign in not working? Try another way" (ROK-2370).
 */
export function LoginPage(): JSX.Element {
    const [isRedirecting, setIsRedirecting] = useState(false);

    useOAuthErrorHandler();
    const { isFirstRun, authProviders, communityName, communityLogoUrl, discordSigninCode } = useCommunityInfo();
    const { isLoading, error, handleLocalLogin } = useLocalLogin(isFirstRun);
    const handleCodeSignedIn = useCodeSignedIn(isFirstRun);

    const handleProviderLogin = (provider: LoginMethodDto): void => {
        setIsRedirecting(true);
        window.location.href = `${API_BASE_URL}${provider.loginPath}`;
    };

    return (
        <div className="min-h-[70vh] flex items-center justify-center px-4">
            <div className="w-full max-w-md">
                <div className="bg-panel/50 backdrop-blur-sm rounded-2xl shadow-xl border border-edge/50 p-8">
                    <LoginHeader communityName={communityName} communityLogoUrl={communityLogoUrl} />
                    <LoginBody authProviders={authProviders} isRedirecting={isRedirecting}
                        onProviderLogin={handleProviderLogin} isFirstRun={isFirstRun} discordSigninCode={discordSigninCode}
                        onLocalLogin={handleLocalLogin} isLoading={isLoading} error={error} onCodeSignedIn={handleCodeSignedIn} />
                    <FirstRunBanner isFirstRun={isFirstRun} />
                </div>
                <p className="mt-6 text-center text-sm text-dim">Coordinate raids. Track attendance. Conquer together.</p>
                <p className="mt-2 text-center text-xs">
                    <Link to="/privacy" className="text-dim underline hover:text-secondary">Privacy policy</Link>
                </p>
            </div>
        </div>
    );
}

/** Executes the local auth API call and redirects on success */
async function performLocalLogin({ username, password, login, isFirstRun, navigate }: {
    username: string; password: string;
    login: (token: string) => Promise<User | null>;
    isFirstRun: boolean; navigate: ReturnType<typeof useNavigate>;
}): Promise<void> {
    const response = await nativeFetch(`${API_BASE_URL}/auth/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        // ROK-1353: include so the httpOnly `rl_rt` Set-Cookie is honored.
        credentials: 'include',
    });
    const data = await response.json().catch(() => ({ message: 'Server unavailable' }));
    if (!response.ok) throw new Error(data.message || 'Invalid credentials');
    setAuthMethod('local');
    clearSilentGuard();
    const user = await login(data.access_token);
    if (!user) throw new Error('Failed to authenticate');
    recordLastSignin('password', user);
    toast.success('Logged in successfully!');
    handlePostLoginRedirect(user, isFirstRun, navigate);
}

/** Login page header with logo and community name */
function LoginHeader({ communityName, communityLogoUrl }: {
    communityName: string; communityLogoUrl: string | null;
}): JSX.Element {
    return (
        <div className="text-center mb-8">
            {communityLogoUrl ? (
                <img src={communityLogoUrl} alt={communityName} width={64} height={64} className="w-16 h-16 mx-auto rounded-xl object-contain" />
            ) : (
                <span className="text-4xl">&#x2694;&#xFE0F;</span>
            )}
            <h1 className="text-2xl font-bold text-foreground mt-2">{communityName}</h1>
            <p className="text-muted mt-1">Sign in to manage your raids</p>
        </div>
    );
}

/** First-run info banner */
function FirstRunBanner({ isFirstRun }: { isFirstRun: boolean }): JSX.Element | null {
    if (!isFirstRun) return null;
    return (
        <div className="mt-6 p-3 bg-overlay/30 border border-edge rounded-lg">
            <p className="text-sm text-secondary text-center">First time? Your admin credentials are in the container logs.</p>
        </div>
    );
}
