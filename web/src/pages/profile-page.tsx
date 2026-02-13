import { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { useAuth } from '../hooks/use-auth';
import { useMyCharacters } from '../hooks/use-characters';
import { useGameRegistry } from '../hooks/use-game-registry';
import {
    useThemeStore,
    getLightThemes,
    getDarkThemes,
} from '../stores/theme-store';
import type { ThemeDefinition, ThemeModePreference } from '../stores/theme-store';

import { CharacterList, AddCharacterModal, NotificationPreferencesSection } from '../components/profile';
import { TimezoneSection } from '../components/profile/TimezoneSection';
import { GameTimePanel } from '../components/features/game-time';


/**
 * Legacy profile page — kept for reference but not routed.
 * Active profile uses ProfileLayout with sidebar navigation (ROK-290).
 */
export function ProfilePage() {
    const { user, isLoading: authLoading, isAuthenticated, refetch } = useAuth();
    const { data: charactersData, isLoading: charactersLoading } = useMyCharacters(undefined, isAuthenticated);
    const { games } = useGameRegistry();
    const location = useLocation();

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingCharacter, setEditingCharacter] = useState<CharacterDto | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<string>('');

    // Scroll to hash anchor (e.g., #game-time from modal link)
    useEffect(() => {
        if (location.hash) {
            const el = document.querySelector(location.hash);
            if (el) {
                // Small delay to let the page render fully
                setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }
        }
    }, [location.hash]);

    // Show loading state while checking auth
    if (authLoading) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
            </div>
        );
    }

    // Redirect if not authenticated
    if (!isAuthenticated || !user) {
        return <Navigate to="/" replace />;
    }

    const characters = charactersData?.data ?? [];

    // Pre-selected game: only set when editing or explicitly chosen (single-game shortcut)
    const activeGameId = editingCharacter?.gameId ?? (selectedGameId || undefined);
    const activeGameName = activeGameId ? (games.find(g => g.id === activeGameId)?.name || 'Unknown Game') : undefined;

    function handleAddCharacter() {
        setEditingCharacter(null);
        if (games.length === 1) {
            setSelectedGameId(games[0].id);
        }
        setShowAddModal(true);
    }

    function handleEditCharacter(character: CharacterDto) {
        setEditingCharacter(character);
        setSelectedGameId(character.gameId);
        setShowAddModal(true);
    }

    function handleCloseCharacterModal() {
        setShowAddModal(false);
        setEditingCharacter(null);
        setSelectedGameId('');
    }

    return (
        <div className="profile-page relative min-h-screen py-8 px-4">
            {/* Full-page space background (future theme candidate) */}
            <div className="profile-page__nebula" />
            <div className="profile-page__stars" />

            <div className="relative z-10 max-w-3xl mx-auto space-y-8">
                {/* Page Header */}
                <div>
                    <h1 className="text-3xl font-bold text-foreground mb-2">My Profile</h1>
                    <p className="text-muted">
                        Manage your characters, game time, and preferences
                    </p>
                </div>

                {/* Appearance Section (ROK-280) */}
                <AppearanceSection />

                {/* Timezone Section (ROK-187) */}
                <TimezoneSection />

                {/* Notification Preferences Section (ROK-179) */}
                <NotificationPreferencesSection />

                {/* Game Time Section (ROK-189) -- unified panel */}
                <div id="game-time" className="bg-surface border border-edge-subtle rounded-xl p-6 scroll-mt-8">
                    <GameTimePanel
                        mode="profile"
                        rolling
                        enabled={isAuthenticated}
                    />
                </div>

                {/* Characters Section */}
                <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-semibold text-foreground">My Characters</h2>
                        <button
                            onClick={handleAddCharacter}
                            disabled={games.length === 0}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add Character
                        </button>
                    </div>

                    {charactersLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
                        </div>
                    ) : (
                        <CharacterList
                            characters={characters}
                            onEdit={handleEditCharacter}
                        />
                    )}
                </div>
            </div>

            {/* Add/Edit Character Modal */}
            <AddCharacterModal
                isOpen={showAddModal}
                onClose={handleCloseCharacterModal}
                gameId={activeGameId}
                gameName={activeGameName}
                editingCharacter={editingCharacter}
            />
        </div>
    );
}

// ============================================================
// Mode Options
// ============================================================

const MODE_OPTIONS: Array<{
    mode: ThemeModePreference;
    label: string;
    subtitle: string;
    icon: 'sun' | 'moon' | 'monitor';
}> = [
    { mode: 'light', label: 'Light', subtitle: 'Always light', icon: 'sun' },
    { mode: 'dark', label: 'Dark', subtitle: 'Always dark', icon: 'moon' },
    { mode: 'auto', label: 'Auto', subtitle: 'Match system', icon: 'monitor' },
];

function ModeIcon({ icon, className }: { icon: 'sun' | 'moon' | 'monitor'; className?: string }) {
    const cls = className ?? 'w-5 h-5';
    if (icon === 'sun') {
        return (
            <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
        );
    }
    if (icon === 'moon') {
        return (
            <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
        );
    }
    return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
    );
}

// ============================================================
// Appearance Section (AC-4)
// ============================================================

function AppearanceSection() {
    const themeMode = useThemeStore((s) => s.themeMode);
    const lightTheme = useThemeStore((s) => s.lightTheme);
    const darkTheme = useThemeStore((s) => s.darkTheme);
    const setMode = useThemeStore((s) => s.setMode);
    const setLightTheme = useThemeStore((s) => s.setLightTheme);
    const setDarkTheme = useThemeStore((s) => s.setDarkTheme);

    const lightThemes = getLightThemes();
    const darkThemes = getDarkThemes();

    const showLightPicker = themeMode === 'light' || themeMode === 'auto';
    const showDarkPicker = themeMode === 'dark' || themeMode === 'auto';

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-1">Appearance</h2>
            <p className="text-sm text-muted mb-5">Choose your preferred color scheme and theme</p>

            {/* Mode Selector */}
            <div className="flex gap-3 mb-6">
                {MODE_OPTIONS.map((opt) => (
                    <button
                        key={opt.mode}
                        onClick={() => setMode(opt.mode)}
                        className={`flex-1 flex flex-col items-center gap-1.5 px-4 py-3 rounded-lg border-2 transition-colors ${
                            themeMode === opt.mode
                                ? 'border-emerald-500 bg-emerald-500/10 text-foreground'
                                : 'border-edge bg-panel text-secondary hover:border-edge-strong'
                        }`}
                    >
                        <ModeIcon icon={opt.icon} className="w-5 h-5" />
                        <div className="font-medium text-sm">{opt.label}</div>
                        <div className="text-xs text-muted">{opt.subtitle}</div>
                    </button>
                ))}
            </div>

            {/* Theme Pickers */}
            {showLightPicker && (
                <ThemePicker
                    label={themeMode === 'auto' ? 'Light Mode Theme' : 'Light Themes'}
                    themes={lightThemes}
                    activeId={lightTheme}
                    onSelect={setLightTheme}
                />
            )}
            {showDarkPicker && (
                <ThemePicker
                    label={themeMode === 'auto' ? 'Dark Mode Theme' : 'Dark Themes'}
                    themes={darkThemes}
                    activeId={darkTheme}
                    onSelect={setDarkTheme}
                />
            )}
        </div>
    );
}

// ============================================================
// Theme Picker — visual cards showing available themes
// ============================================================

function ThemePicker({
    label,
    themes,
    activeId,
    onSelect,
}: {
    label?: string;
    themes: ThemeDefinition[];
    activeId: string;
    onSelect: (id: string) => void;
}) {
    // Don't show picker if there's only one theme (nothing to choose)
    if (themes.length <= 1) return null;

    return (
        <div className="mb-4 last:mb-0">
            {label && (
                <h3 className="text-sm font-medium text-secondary mb-2">{label}</h3>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {themes.map((theme) => (
                    <ThemeCard
                        key={theme.id}
                        theme={theme}
                        isActive={activeId === theme.id}
                        onClick={() => onSelect(theme.id)}
                    />
                ))}
            </div>
        </div>
    );
}

function ThemeCard({
    theme,
    isActive,
    onClick,
}: {
    theme: ThemeDefinition;
    isActive: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`relative flex flex-col items-start gap-2 p-3 rounded-lg border-2 transition-colors text-left ${
                isActive
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-edge bg-panel hover:border-edge-strong'
            }`}
        >
            {/* Color preview */}
            <div className="flex gap-2">
                <div
                    className="w-8 h-8 rounded-md border border-edge"
                    style={{ backgroundColor: theme.preview.surface }}
                    title="Surface color"
                />
                <div
                    className="w-8 h-8 rounded-md border border-edge"
                    style={{ backgroundColor: theme.preview.accent }}
                    title="Accent color"
                />
            </div>
            {/* Name */}
            <span className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-secondary'}`}>
                {theme.name}
            </span>
            {/* Active indicator */}
            {isActive && (
                <div className="absolute top-2 right-2">
                    <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                </div>
            )}
        </button>
    );
}
