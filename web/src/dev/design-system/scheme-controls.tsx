/**
 * Scheme controls for /dev/design-system (ROK-1539).
 *
 * Eight of the fifteen registered schemes are dark and six are light (plus
 * `quest-log`, which is applied through `data-variant` rather than
 * `data-scheme` — see `theme-helpers.ts:53,76-82`). Everything here goes
 * through the theme store's own actions (`./scheme-hooks`) so the page cannot
 * drift from how the app actually applies a theme; nothing writes
 * `data-scheme` by hand.
 */
import type { JSX } from 'react';
import { useThemeStore } from '../../stores/theme-store';
import { THEME_REGISTRY } from '../../stores/theme-registry';
import { useApplyScheme } from './scheme-hooks';

const SELECT_CLS =
    'min-h-[44px] bg-panel border border-edge rounded-md px-3 py-2 text-sm text-foreground ' +
    'focus:outline-none focus:ring-2 focus:ring-emerald-500/50';

/** Root-level scheme picker covering every theme in the registry. */
export function SchemeSwitcher(): JSX.Element {
    const currentId = useThemeStore((s) => s.resolved.id);
    const applyScheme = useApplyScheme();
    return (
        <label className="flex items-center gap-2 text-xs text-muted">
            <span>Scheme</span>
            <select
                aria-label="Scheme"
                className={SELECT_CLS}
                value={currentId}
                onChange={(e) => applyScheme(e.target.value)}
            >
                {THEME_REGISTRY.map((t) => (
                    <option key={t.id} value={t.id}>{`${t.name} — ${t.mode}`}</option>
                ))}
            </select>
        </label>
    );
}

const CHIP_CLS =
    'inline-flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full text-sm font-medium transition-colors';
const CHIP_ON = 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20';
const CHIP_OFF = 'bg-panel border border-edge text-secondary hover:bg-overlay';

/**
 * Chip toggle for the scoped two-column preview (§4.3 geometry; `text-amber-400`
 * rather than the canonical `text-amber-300` precisely because this page must be
 * readable in the light family — see docs/design-system.md §6.9).
 */
export function SideBySideToggle({ active, onToggle }: {
    active: boolean;
    onToggle: () => void;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onToggle}
            className={`${CHIP_CLS} ${active ? CHIP_ON : CHIP_OFF}`}
        >
            Side by side (light + dark)
        </button>
    );
}
