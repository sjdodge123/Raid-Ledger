import {
    useThemeStore,
    getLightThemes,
    getDarkThemes,
} from '../../stores/theme-store';
import type { ThemeDefinition, ThemeModePreference } from '../../stores/theme-store';

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
    if (icon === 'sun') return (<svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>);
    if (icon === 'moon') return (<svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>);
    return (<svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>);
}

function ThemePicker({ label, themes, activeId, onSelect }: { label?: string; themes: ThemeDefinition[]; activeId: string; onSelect: (id: string) => void }) {
    if (themes.length <= 1) return null;
    return (
        <div className="mb-4 last:mb-0">
            {label && <h3 className="text-sm font-medium text-secondary mb-2">{label}</h3>}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {themes.map((theme) => (
                    <ThemeCard key={theme.id} theme={theme} isActive={activeId === theme.id} onClick={() => onSelect(theme.id)} />
                ))}
            </div>
        </div>
    );
}

function ThemeCard({ theme, isActive, onClick }: { theme: ThemeDefinition; isActive: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`relative flex flex-col items-start gap-2 p-3 rounded-lg border-2 transition-colors text-left ${isActive ? 'border-emerald-500 bg-emerald-500/10' : 'border-edge bg-panel hover:border-edge-strong'}`}
        >
            <div className="flex gap-2">
                <div className="w-8 h-8 rounded-md border border-edge" style={{ backgroundColor: theme.preview.surface }} title="Surface color" />
                <div className="w-8 h-8 rounded-md border border-edge" style={{ backgroundColor: theme.preview.accent }} title="Accent color" />
            </div>
            <span className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-secondary'}`}>{theme.name}</span>
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

export function AppearancePanel() {
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
            <div className="flex gap-3 mb-6">
                {MODE_OPTIONS.map((opt) => (
                    <button
                        key={opt.mode}
                        onClick={() => setMode(opt.mode)}
                        className={`flex-1 flex flex-col items-center gap-1.5 px-4 py-3 rounded-lg border-2 transition-colors ${themeMode === opt.mode ? 'border-emerald-500 bg-emerald-500/10 text-foreground' : 'border-edge bg-panel text-secondary hover:border-edge-strong'}`}
                    >
                        <ModeIcon icon={opt.icon} className="w-5 h-5" />
                        <div className="font-medium text-sm">{opt.label}</div>
                        <div className="text-xs text-muted">{opt.subtitle}</div>
                    </button>
                ))}
            </div>
            {showLightPicker && <ThemePicker label={themeMode === 'auto' ? 'Light Mode Theme' : undefined} themes={lightThemes} activeId={lightTheme} onSelect={setLightTheme} />}
            {showDarkPicker && <ThemePicker label={themeMode === 'auto' ? 'Dark Mode Theme' : 'Dark Themes'} themes={darkThemes} activeId={darkTheme} onSelect={setDarkTheme} />}
        </div>
    );
}
