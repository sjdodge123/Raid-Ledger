/**
 * Scheme controls for /dev/design-system (ROK-1539).
 *
 * Nine of the fifteen registered schemes are dark and six are light — one of the six,
 * `quest-log`, is applied through `data-variant` rather than `data-scheme` (see
 * `theme-helpers.ts:53,76-82`). Everything here goes
 * through the theme store's own actions (`./scheme-hooks`) so the page cannot
 * drift from how the app actually applies a theme; nothing writes
 * `data-scheme` by hand.
 */
import type { JSX } from 'react';
import { useThemeStore } from '../../stores/theme-store';
import { THEME_REGISTRY } from '../../stores/theme-registry';
import { useApplyScheme } from './scheme-hooks';
import { FilterChip } from '../../components/ui/filter-chip';

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

/**
 * Chip toggle for the scoped two-column preview — the shared §4.3 `FilterChip`
 * (its ON label is `text-amber-400`, readable in the light family — §6.9).
 */
export function SideBySideToggle({ active, onToggle }: {
    active: boolean;
    onToggle: () => void;
}): JSX.Element {
    return <FilterChip label="Side by side (light + dark)" pressed={active} onPressedChange={onToggle} />;
}
