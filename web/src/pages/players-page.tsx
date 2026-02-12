import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePlayers } from '../hooks/use-players';
import { resolveAvatar, toAvatarUser } from '../lib/avatar';

export function PlayersPage() {
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const { data, isLoading } = usePlayers(page, debouncedSearch);
    const players = data?.data ?? [];
    const total = data?.meta.total ?? 0;
    const limit = data?.meta.limit ?? 20;
    const totalPages = Math.ceil(total / limit);

    return (
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <h1 className="text-2xl font-bold text-foreground">Players</h1>
                <span className="text-sm text-muted">{total} registered</span>
            </div>

            {/* Search */}
            <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search players..."
                    className="w-full pl-10 pr-4 py-2.5 bg-panel border border-edge rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                />
            </div>

            {/* Player Grid */}
            {isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className="bg-panel border border-edge rounded-lg p-4 animate-pulse">
                            <div className="w-16 h-16 rounded-full bg-overlay mx-auto" />
                            <div className="h-4 w-20 bg-overlay rounded mx-auto mt-3" />
                        </div>
                    ))}
                </div>
            ) : players.length === 0 ? (
                <div className="text-center py-12 text-muted">
                    <p className="text-lg">No players found</p>
                    {debouncedSearch && (
                        <p className="text-sm mt-1">Try a different search term</p>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {players.map((player) => {
                        const avatar = resolveAvatar(toAvatarUser(player));
                        return (
                            <Link
                                key={player.id}
                                to={`/users/${player.id}`}
                                className="bg-panel border border-edge rounded-lg p-4 hover:bg-overlay transition-colors text-center group"
                            >
                                {avatar.url ? (
                                    <img
                                        src={avatar.url}
                                        alt={player.username}
                                        className="w-16 h-16 rounded-full mx-auto bg-overlay object-cover"
                                        onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                        }}
                                    />
                                ) : null}
                                <div className={`w-16 h-16 rounded-full mx-auto bg-overlay flex items-center justify-center text-2xl text-muted ${avatar.url ? 'hidden' : ''}`}>
                                    {player.username.charAt(0).toUpperCase()}
                                </div>
                                <div className="mt-3 text-sm font-medium text-foreground group-hover:text-emerald-400 transition-colors truncate">
                                    {player.username}
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="px-3 py-1.5 text-sm bg-panel border border-edge rounded hover:bg-overlay disabled:opacity-50 disabled:cursor-not-allowed text-foreground transition-colors"
                    >
                        Previous
                    </button>
                    <span className="text-sm text-muted px-2">
                        Page {page} of {totalPages}
                    </span>
                    <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="px-3 py-1.5 text-sm bg-panel border border-edge rounded hover:bg-overlay disabled:opacity-50 disabled:cursor-not-allowed text-foreground transition-colors"
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}
