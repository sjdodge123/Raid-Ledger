import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useSystemStatus } from '../hooks/use-system-status';
import { API_BASE_URL } from '../lib/config';
import { toast } from '../lib/toast';
import { consumeAuthRedirect } from '../components/auth';
import { DiscordIcon } from '../components/icons/DiscordIcon';
import type { LoginMethodDto } from '@raid-ledger/contract';

/**
 * Login page with pluggable auth providers and local username/password options.
 * When auth providers are configured (e.g. Discord), OAuth is shown prominently
 * with local login collapsed behind a toggle. For self-hosted deployments
 * without providers, local auth is the primary option.
 */
export function LoginPage() {
    const navigate = useNavigate();
    const { login } = useAuth();
    const { data: systemStatus } = useSystemStatus();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [showLocalLogin, setShowLocalLogin] = useState(false);

    const isFirstRun = systemStatus?.isFirstRun ?? false;
    const authProviders: LoginMethodDto[] = systemStatus?.authProviders ?? [];
    const hasProviders = authProviders.length > 0;
    const communityName = systemStatus?.communityName || 'Raid Ledger';
    const communityLogoUrl = systemStatus?.communityLogoUrl
        ? `${API_BASE_URL}${systemStatus.communityLogoUrl}`
        : null;

    // Auto-expand local login on first run so admin can see the credentials form
    useEffect(() => {
        if (isFirstRun && hasProviders) {
            setShowLocalLogin(true);
        }
    }, [isFirstRun, hasProviders]);

    const handleLocalLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            const response = await fetch(`${API_BASE_URL}/auth/local`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json().catch(() => ({
                message: 'Server unavailable — please try again shortly',
            }));

            if (!response.ok) {
                throw new Error(data.message || 'Invalid credentials');
            }

            // Store token and fetch user data in one step
            const user = await login(data.access_token);

            if (!user) {
                throw new Error('Failed to authenticate');
            }

            toast.success('Logged in successfully!');

            // AC-6: First-run welcome toast (shows once)
            const hasSeenWelcome = localStorage.getItem('rl-welcome-shown');
            if (isFirstRun && !hasSeenWelcome) {
                localStorage.setItem('rl-welcome-shown', 'true');
                setTimeout(() => {
                    toast.info('Welcome! Visit your Profile to add characters.', {
                        duration: 6000,
                    });
                }, 1000);
            }

            // ROK-219: Redirect new non-admin users to onboarding wizard
            if (user && user.role !== 'admin' && !user.onboardingCompletedAt) {
                toast.success('Welcome! Let\'s get you set up.');
                navigate('/onboarding', { replace: true });
                return;
            }

            // Respect saved redirect destination (ROK-175: default to calendar)
            const redirectTo = consumeAuthRedirect() || '/calendar';
            navigate(redirectTo, { replace: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Login failed';
            setError(message);
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleProviderLogin = (provider: LoginMethodDto) => {
        // Show loading state during redirect
        setIsRedirecting(true);
        // Redirect to provider OAuth endpoint
        window.location.href = `${API_BASE_URL}${provider.loginPath}`;
    };

    const localLoginForm = (
        <form onSubmit={handleLocalLogin} className="space-y-4">
            <div>
                <label
                    htmlFor="username"
                    className="block text-sm font-medium text-secondary mb-1.5"
                >
                    Username
                </label>
                <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    placeholder="admin"
                    required
                />
            </div>

            <div>
                <label
                    htmlFor="password"
                    className="block text-sm font-medium text-secondary mb-1.5"
                >
                    Password
                </label>
                <div className="relative">
                    <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-4 py-3 pr-12 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                        placeholder="••••••••"
                        required
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors p-1"
                        tabIndex={-1}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                        {showPassword ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            )}

            <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
                {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
                        Signing in...
                    </span>
                ) : (
                    'Sign In'
                )}
            </button>
        </form>
    );

    return (
        <div className="min-h-[70vh] flex items-center justify-center px-4">
            <div className="w-full max-w-md">
                <div className="bg-panel/50 backdrop-blur-sm rounded-2xl shadow-xl border border-edge/50 p-8">
                    {/* Logo and Community Name (AC-2, AC-3, ROK-271) */}
                    <div className="text-center mb-8">
                        {communityLogoUrl ? (
                            <img
                                src={communityLogoUrl}
                                alt={communityName}
                                className="w-16 h-16 mx-auto rounded-xl object-contain"
                            />
                        ) : (
                            <span className="text-4xl">&#x2694;&#xFE0F;</span>
                        )}
                        <h1 className="text-2xl font-bold text-foreground mt-2">
                            {communityName}
                        </h1>
                        <p className="text-muted mt-1">
                            Sign in to manage your raids
                        </p>
                    </div>

                    {hasProviders ? (
                        <>
                            {/* Auth provider buttons (ROK-267) */}
                            <div className="space-y-3">
                                {authProviders.map((provider) => (
                                    <button
                                        key={provider.key}
                                        onClick={() => handleProviderLogin(provider)}
                                        disabled={isRedirecting}
                                        className="w-full py-3.5 px-4 bg-[#5865F2] hover:bg-[#4752C4] disabled:bg-[#5865F2]/50 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors flex items-center justify-center gap-3 focus:outline-none focus:ring-2 focus:ring-[#5865F2] focus:ring-offset-2 focus:ring-offset-slate-900"
                                    >
                                        {isRedirecting ? (
                                            <>
                                                <span className="w-5 h-5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
                                                Redirecting...
                                            </>
                                        ) : (
                                            <>
                                                {provider.icon === 'discord' && <DiscordIcon className="w-5 h-5" />}
                                                {provider.label}
                                            </>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {/* Toggle for local login */}
                            <div className="text-center mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowLocalLogin(!showLocalLogin)}
                                    className="text-sm text-muted hover:text-secondary transition-colors"
                                >
                                    {showLocalLogin ? 'Hide username login' : 'Sign in with username instead'}
                                </button>
                            </div>

                            {/* Collapsible local login form */}
                            {showLocalLogin && (
                                <div className="mt-4">
                                    <div className="relative mb-6">
                                        <div className="absolute inset-0 flex items-center">
                                            <div className="w-full border-t border-edge" />
                                        </div>
                                    </div>
                                    {localLoginForm}
                                </div>
                            )}
                        </>
                    ) : (
                        /* No providers configured: local form is primary */
                        localLoginForm
                    )}

                    {/* First-run hint (ROK-175 AC-5) */}
                    {isFirstRun && (
                        <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                            <p className="text-sm text-blue-300 text-center">
                                First time? Your admin credentials are in the container logs.
                            </p>
                        </div>
                    )}

                </div>

                {/* Subtle tagline (AC-2) */}
                <p className="mt-6 text-center text-sm text-dim">
                    Coordinate raids. Track attendance. Conquer together.
                </p>
            </div>
        </div>
    );
}
