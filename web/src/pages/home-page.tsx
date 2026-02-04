import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { API_BASE_URL } from '../lib/config';

/**
 * Landing page with hero section and feature highlights.
 */
export function HomePage() {
    const { isAuthenticated } = useAuth();

    return (
        <div className="min-h-[calc(100vh-8rem)]">
            {/* Hero Section */}
            <section className="relative py-20 px-4 overflow-hidden">
                {/* Background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/20 via-slate-950 to-indigo-900/20" />

                {/* Decorative blur */}
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />

                <div className="relative max-w-5xl mx-auto text-center">
                    <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-bold text-white mb-6">
                        Organize Epic
                        <span className="block mt-2 bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400 bg-clip-text text-transparent">
                            Raid Nights
                        </span>
                    </h1>

                    <p className="text-xl sm:text-2xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                        The all-in-one event management platform for gaming communities.
                        Schedule events, track signups, and never miss a raid again.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        {isAuthenticated ? (
                            <Link
                                to="/events"
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-lg rounded-xl transition-all hover:scale-105 glow-emerald"
                            >
                                <span>View Events</span>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                            </Link>
                        ) : (
                            <a
                                href={`${API_BASE_URL}/auth/discord`}
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-lg rounded-xl transition-all hover:scale-105 glow-indigo"
                            >
                                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                                </svg>
                                Get Started with Discord
                            </a>
                        )}

                        <Link
                            to="/events"
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-lg rounded-xl transition-colors border border-slate-700"
                        >
                            Browse Events
                        </Link>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="py-20 px-4 bg-slate-900/50">
                <div className="max-w-6xl mx-auto">
                    <h2 className="font-display text-3xl sm:text-4xl font-bold text-white text-center mb-4">
                        Everything You Need
                    </h2>
                    <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
                        Built for gaming communities who want a better way to organize
                    </p>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {features.map((feature, index) => (
                            <div
                                key={index}
                                className="p-6 rounded-xl glass-card"
                            >
                                <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-lg flex items-center justify-center text-2xl mb-4">
                                    {feature.icon}
                                </div>
                                <h3 className="text-xl font-semibold text-white mb-2">
                                    {feature.title}
                                </h3>
                                <p className="text-slate-400">
                                    {feature.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-20 px-4">
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mb-4">
                        Ready to get started?
                    </h2>
                    <p className="text-slate-400 mb-8 text-lg">
                        Join with your Discord account and start organizing events in minutes.
                    </p>
                    <a
                        href={isAuthenticated ? "/events" : `${API_BASE_URL}/auth/discord`}
                        className="inline-flex items-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-lg rounded-xl transition-all hover:scale-105 glow-emerald"
                    >
                        {isAuthenticated ? 'Go to Events' : 'Join Now — It\'s Free'}
                    </a>
                </div>
            </section>
        </div>
    );
}

const features = [
    {
        icon: '🎮',
        title: 'Game Discovery',
        description: 'Search from thousands of games powered by IGDB. Find the perfect game for your next session.',
    },
    {
        icon: '📅',
        title: 'Event Scheduling',
        description: 'Create events with date/time pickers, descriptions, and automatic timezone handling.',
    },
    {
        icon: '✅',
        title: 'Smart Signups',
        description: 'One-click signups with character selection. Know exactly who\'s coming and their role.',
    },
    {
        icon: '👥',
        title: 'Character Management',
        description: 'Track your main and alt characters across games. Show raid leaders what you can bring.',
    },
    {
        icon: '🔔',
        title: 'Discord Integration',
        description: 'Login with Discord, get notifications, and share events directly to your server.',
    },
    {
        icon: '📊',
        title: 'Roster Building',
        description: 'Visual roster management for raid leaders. See composition at a glance.',
    },
];
