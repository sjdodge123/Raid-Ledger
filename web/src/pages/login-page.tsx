import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useSystemStatus } from '../hooks/use-system-status';
import { API_BASE_URL } from '../lib/config';
import { toast } from 'sonner';
import { consumeAuthRedirect } from '../components/auth';
import { DiscordIcon } from '../components/icons/DiscordIcon';

/**
 * Login page with local username/password and Discord OAuth options.
 * For self-hosted deployments, users can bootstrap with local auth,
 * then link their Discord account later.
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

    const isFirstRun = systemStatus?.isFirstRun ?? false;
    const discordConfigured = systemStatus?.discordConfigured ?? false;
    const communityName = import.meta.env.VITE_COMMUNITY_NAME || 'Raid-Ledger';

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

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Invalid credentials');
            }

            // Store token and redirect
            login(data.access_token);
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

    const handleDiscordLogin = () => {
        // Show loading state during redirect
        setIsRedirecting(true);
        // Save current redirect (if any was set before arriving at login)
        // The ProtectedRoute would have already saved it, but we keep it intact
        // Redirect to Discord OAuth
        window.location.href = `${API_BASE_URL}/auth/discord`;
    };

    return (
        <div className="min-h-[70vh] flex items-center justify-center px-4">
            <div className="w-full max-w-md">
                <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-700/50 p-8">
                    {/* Logo and Community Name (AC-2, AC-3) */}
                    <div className="text-center mb-8">
                        <span className="text-4xl">⚔️</span>
                        <h1 className="text-2xl font-bold text-white mt-2">
                            {communityName}
                        </h1>
                        <p className="text-slate-400 mt-1">
                            Sign in to manage your raids
                        </p>
                    </div>

                    {/* Local Auth Form (AC-5: Username field) */}
                    <form onSubmit={handleLocalLogin} className="space-y-4">
                        <div>
                            <label
                                htmlFor="username"
                                className="block text-sm font-medium text-slate-300 mb-1.5"
                            >
                                Username
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                                placeholder="admin"
                                required
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="password"
                                className="block text-sm font-medium text-slate-300 mb-1.5"
                            >
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                                <p className="text-sm text-red-400">{error}</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Signing in...
                                </span>
                            ) : (
                                'Sign In'
                            )}
                        </button>
                    </form>

                    {/* Conditional Discord OAuth Button (AC-4) */}
                    {discordConfigured && (
                        <>
                            {/* Divider */}
                            <div className="relative my-8">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-slate-700" />
                                </div>
                                <div className="relative flex justify-center text-sm">
                                    <span className="px-4 bg-slate-800/50 text-slate-400">
                                        or continue with
                                    </span>
                                </div>
                            </div>

                            <button
                                onClick={handleDiscordLogin}
                                disabled={isRedirecting}
                                className="w-full py-3 px-4 bg-[#5865F2] hover:bg-[#4752C4] disabled:bg-[#5865F2]/50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-3 focus:outline-none focus:ring-2 focus:ring-[#5865F2] focus:ring-offset-2 focus:ring-offset-slate-900"
                            >
                                {isRedirecting ? (
                                    <>
                                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Redirecting to Discord...
                                    </>
                                ) : (
                                    <>
                                        <DiscordIcon className="w-5 h-5" />
                                        Login with Discord
                                    </>
                                )}
                            </button>
                        </>
                    )}

                    {/* First-run hint (ROK-175 AC-5) */}
                    {isFirstRun && (
                        <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                            <p className="text-sm text-blue-300 text-center">
                                🎉 First time? Your admin credentials are in the container logs.
                            </p>
                        </div>
                    )}
                </div>

                {/* Subtle tagline (AC-2) */}
                <p className="mt-6 text-center text-sm text-slate-500">
                    Coordinate raids. Track attendance. Conquer together.
                </p>
            </div>
        </div>
    );
}
