/**
 * Filter controls for the Common Ground panel (ROK-934).
 * Min owners slider, genre dropdown, max players input.
 */
import { type JSX, useCallback } from 'react';
import type { CommonGroundParams } from '../../lib/api-client';

interface Props {
    filters: CommonGroundParams;
    onChange: (next: CommonGroundParams) => void;
    availableTags: string[];
}

/** Slider for the minimum owners threshold (0–15). */
function MinOwnersSlider({
    value,
    onChange,
}: {
    value: number;
    onChange: (v: number) => void;
}): JSX.Element {
    return (
        <label className="flex items-center gap-2 text-sm text-muted">
            <span className="whitespace-nowrap">Min owners</span>
            <input
                type="range"
                min={0}
                max={15}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-24 accent-emerald-500"
            />
            <span className="text-xs font-mono w-5 text-right">{value}</span>
        </label>
    );
}

/** Dropdown to filter by ITAD tag / genre. */
function GenreDropdown({
    value,
    tags,
    onChange,
}: {
    value: string | undefined;
    tags: string[];
    onChange: (v: string | undefined) => void;
}): JSX.Element {
    return (
        <select
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || undefined)}
            className="bg-panel border border-edge/50 rounded px-2 py-1 text-sm text-muted"
        >
            <option value="">All genres</option>
            {tags.map((t) => (
                <option key={t} value={t}>{t}</option>
            ))}
        </select>
    );
}

/** Number input for max player count. */
function MaxPlayersInput({
    value,
    onChange,
}: {
    value: number | undefined;
    onChange: (v: number | undefined) => void;
}): JSX.Element {
    return (
        <label className="flex items-center gap-2 text-sm text-muted">
            <span className="whitespace-nowrap">Max players</span>
            <input
                type="number"
                min={1}
                max={999}
                value={value ?? ''}
                placeholder="Any"
                onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
                className="w-16 bg-panel border border-edge/50 rounded px-2 py-1 text-sm text-muted"
            />
        </label>
    );
}

/** Filter bar for the Common Ground panel. */
export function CommonGroundFilters({ filters, onChange, availableTags }: Props): JSX.Element {
    const update = useCallback(
        (patch: Partial<CommonGroundParams>) => onChange({ ...filters, ...patch }),
        [filters, onChange],
    );

    return (
        <div className="flex flex-wrap items-center gap-4">
            <MinOwnersSlider
                value={filters.minOwners ?? 2}
                onChange={(v) => update({ minOwners: v })}
            />
            <GenreDropdown
                value={filters.genre}
                tags={availableTags}
                onChange={(v) => update({ genre: v })}
            />
            <MaxPlayersInput
                value={filters.maxPlayers}
                onChange={(v) => update({ maxPlayers: v })}
            />
        </div>
    );
}
