import { useThemeStore } from '../../stores/theme-store';

/**
 * Theme mode cycle button (AC-5) — toggles mode: dark -> light -> space -> auto.
 * Icon reflects current mode: moon (dark), sun (light), stars (space), monitor (auto).
 */
export function ThemeToggle() {
    const themeMode = useThemeStore((s) => s.themeMode);
    const cycleTheme = useThemeStore((s) => s.cycleTheme);

    const label =
        themeMode === 'auto'
            ? 'Auto (system)'
            : themeMode === 'light'
              ? 'Light mode'
              : themeMode === 'space'
                ? 'Space mode'
                : 'Dark mode';

    return (
        <button
            onClick={cycleTheme}
            className="p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel"
            aria-label={label}
            title={label}
        >
            {themeMode === 'light' ? (
                <SunIcon />
            ) : themeMode === 'auto' ? (
                <MonitorIcon />
            ) : themeMode === 'space' ? (
                <SpaceIcon />
            ) : (
                <MoonIcon />
            )}
        </button>
    );
}

function MoonIcon() {
    return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
            />
        </svg>
    );
}

function SunIcon() {
    return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
            />
        </svg>
    );
}

function MonitorIcon() {
    return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
        </svg>
    );
}

/** Rocket icon for Space theme mode (ROK-228) */
function SpaceIcon() {
    return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-6.233 0c-1.296 1.296-1.436 3.297-.376 4.753l.117.146c1.164 1.37 3.31 1.37 4.473 0 1.164-1.37 1.164-3.383 0-4.753l-.117-.146z"
            />
            <circle cx="19.5" cy="4.5" r="1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="2" r="0.5" fill="currentColor" stroke="none" />
        </svg>
    );
}
