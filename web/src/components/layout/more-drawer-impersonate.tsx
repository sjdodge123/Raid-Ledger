import { useRef, useState } from 'react';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';

interface ImpersonateSectionProps {
    impersonateUsers: { id: number; username: string; avatar: string | null; discordId: string | null; customAvatarUrl: string | null }[] | undefined;
    onImpersonate: (userId: number) => void;
}

export function ImpersonateSection({ impersonateUsers, onImpersonate }: ImpersonateSectionProps) {
    const [showMenu, setShowMenu] = useState(false);
    const [search, setSearch] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);

    const handleToggle = () => {
        const next = !showMenu;
        setShowMenu(next);
        if (!next) setSearch('');
        else setTimeout(() => searchRef.current?.focus(), 0);
    };

    const handleSelect = (userId: number) => {
        setShowMenu(false);
        setSearch('');
        onImpersonate(userId);
    };

    const filtered = (Array.isArray(impersonateUsers) ? impersonateUsers : []).filter((u) =>
        u.username.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="px-4 py-4 border-t border-edge-subtle">
            <button
                onClick={handleToggle}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg font-medium text-foreground hover:bg-overlay/20 transition-colors"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="flex-1 text-left">Impersonate</span>
                <svg
                    className={`w-4 h-4 text-muted transition-transform ${showMenu ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {showMenu && (
                <div className="mt-2 rounded-lg bg-panel/50 overflow-hidden">
                    <div className="p-3">
                        <input
                            ref={searchRef}
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search users..."
                            className="w-full px-3 py-2 text-sm bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                        {filtered.length > 0 ? (
                            filtered.map((u) => {
                                const impAvatar = resolveAvatar(toAvatarUser(u));
                                return (
                                    <button
                                        key={u.id}
                                        onClick={() => handleSelect(u.id)}
                                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-muted hover:bg-overlay/30 hover:text-foreground transition-colors"
                                    >
                                        {impAvatar.url ? (
                                            <img
                                                src={impAvatar.url}
                                                alt={u.username}
                                                className="w-6 h-6 rounded-full bg-faint object-cover"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                                }}
                                            />
                                        ) : null}
                                        <div className={`w-6 h-6 rounded-full bg-faint flex items-center justify-center text-xs font-semibold text-muted ${impAvatar.url ? 'hidden' : ''}`}>
                                            {u.username.charAt(0).toUpperCase()}
                                        </div>
                                        {u.username}
                                    </button>
                                );
                            })
                        ) : (
                            <p className="px-4 py-3 text-xs text-dim">
                                {search ? 'No matches' : 'No users available'}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
