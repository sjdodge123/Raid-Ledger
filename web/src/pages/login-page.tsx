import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useSystemStatus } from '../hooks/use-system-status';
import { API_BASE_URL } from '../lib/config';
import { toast } from '../lib/toast';
import { consumeAuthRedirect } from '../components/auth';
import { DiscordIcon } from '../components/icons/DiscordIcon';
import type { LoginMethodDto } from '@raid-ledger/contract';
import { LocalLoginForm } from './login/LocalLoginForm';

/**
 * Login page with pluggable auth providers and local username/password options.
 * When auth providers are configured (e.g. Discord), OAuth is shown prominently
 * with local login collapsed behind a toggle.
 */
export function LoginPage(): JSX.Element {
    const navigate = useNavigate();
    const { login } = useAuth();
    const { data: systemStatus } = useSystemStatus();
    const [isLoading, setIsLoading] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showLocalLogin, setShowLocalLogin] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();

    useEffect(() => {
        const oauthError = searchParams.get('error');
        if (oauthError === 'oauth_failed') {
            toast.error('Login failed. Please try again.');
            searchParams.delete('error');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const isFirstRun = systemStatus?.isFirstRun ?? false;
    const authProviders: LoginMethodDto[] = systemStatus?.authProviders ?? [];
    const hasProviders = authProviders.length > 0;
    const communityName = systemStatus?.communityName || 'Raid Ledger';
    const communityLogoUrl = systemStatus?.communityLogoUrl ? `${API_BASE_URL}${systemStatus.communityLogoUrl}` : null;

    useEffect(() => {
        if (isFirstRun && hasProviders) setShowLocalLogin(true);
    }, [isFirstRun, hasProviders]);

    const handleLocalLogin = async (username: string, password: string): Promise<void> => {
        setError(null);
        setIsLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/auth/local`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await response.json().catch(() => ({ message: 'Server unavailable' }));
            if (!response.ok) throw new Error(data.message || 'Invalid credentials');
            const user = await login(data.access_token);
            if (!user) throw new Error('Failed to authenticate');
            toast.success('Logged in successfully!');
            handlePostLoginRedirect(user);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Login failed';
            setError(message);
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePostLoginRedirect = (user: { role?: string; onboardingCompletedAt: string | null }): void => {
        const hasSeenWelcome = localStorage.getItem('rl-welcome-shown');
        if (isFirstRun && !hasSeenWelcome) {
            localStorage.setItem('rl-welcome-shown', 'true');
            setTimeout(() => toast.info('Welcome! Visit your Profile to add characters.', { duration: 6000 }), 1000);
        }
        if (user.role !== 'admin' && !user.onboardingCompletedAt) {
            toast.success('Welcome! Let\'s get you set up.');
            navigate('/onboarding', { replace: true });
            return;
        }
        navigate(consumeAuthRedirect() || '/calendar', { replace: true });
    };

    const handleProviderLogin = (provider: LoginMethodDto): void => {
        setIsRedirecting(true);
        window.location.href = `${API_BASE_URL}${provider.loginPath}`;
    };

    return (
        <div className="min-h-[70vh] flex items-center justify-center px-4">
            <div className="w-full max-w-md">
                <div className="bg-panel/50 backdrop-blur-sm rounded-2xl shadow-xl border border-edge/50 p-8">
                    <LoginHeader communityName={communityName} communityLogoUrl={communityLogoUrl} />
                    {hasProviders ? (
                        <>
                            <ProviderButtons providers={authProviders} isRedirecting={isRedirecting} onLogin={handleProviderLogin} />
                            <div className="text-center mt-6">
                                <button type="button" onClick={() => setShowLocalLogin(!showLocalLogin)} className="text-sm text-muted hover:text-secondary transition-colors">
                                    {showLocalLogin ? 'Hide username login' : 'Sign in with username instead'}
                                </button>
                            </div>
                            {showLocalLogin && (
                                <div className="mt-4">
                                    <div className="relative mb-6"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-edge" /></div></div>
                                    <LocalLoginForm onSubmit={handleLocalLogin} isLoading={isLoading} error={error} />
                                </div>
                            )}
                        </>
                    ) : (
                        <LocalLoginForm onSubmit={handleLocalLogin} isLoading={isLoading} error={error} />
                    )}
                    {isFirstRun && (
                        <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                            <p className="text-sm text-blue-300 text-center">First time? Your admin credentials are in the container logs.</p>
                        </div>
                    )}
                </div>
                <p className="mt-6 text-center text-sm text-dim">Coordinate raids. Track attendance. Conquer together.</p>
            </div>
        </div>
    );
}

/** Login page header with logo and community name */
function LoginHeader({ communityName, communityLogoUrl }: {
    communityName: string; communityLogoUrl: string | null;
}): JSX.Element {
    return (
        <div className="text-center mb-8">
            {communityLogoUrl ? (
                <img src={communityLogoUrl} alt={communityName} className="w-16 h-16 mx-auto rounded-xl object-contain" />
            ) : (
                <span className="text-4xl">&#x2694;&#xFE0F;</span>
            )}
            <h1 className="text-2xl font-bold text-foreground mt-2">{communityName}</h1>
            <p className="text-muted mt-1">Sign in to manage your raids</p>
        </div>
    );
}

/** Auth provider login buttons (e.g., Discord) */
function ProviderButtons({ providers, isRedirecting, onLogin }: {
    providers: LoginMethodDto[]; isRedirecting: boolean;
    onLogin: (provider: LoginMethodDto) => void;
}): JSX.Element {
    return (
        <div className="space-y-3">
            {providers.map((provider) => {
                const color = provider.color ?? '#5865F2';
                return (
                    <button key={provider.key} onClick={() => onLogin(provider)} disabled={isRedirecting}
                        className="w-full py-3.5 px-4 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors flex items-center justify-center gap-3 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900"
                        style={{ backgroundColor: color, '--tw-ring-color': color } as React.CSSProperties}>
                        {isRedirecting ? (
                            <><span className="w-5 h-5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />Redirecting...</>
                        ) : (
                            <>{provider.icon === 'discord' && <DiscordIcon className="w-5 h-5" />}{provider.label}</>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
