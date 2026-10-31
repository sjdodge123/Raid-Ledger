/**
 * ROK-1814 — the picker's Emblem section (approved mockup §4): emblem grid,
 * emblem + background colour swatches (fg ≠ bg, Q10), a hero/menu preview and
 * the CC BY credit line. Swatch colours are crest data (the DS exception).
 */
import type { JSX } from 'react';
import {
    GUILD_CREST_EMBLEM_CREDIT_LINE, GUILD_CREST_EMBLEM_IDS, GUILD_CREST_PALETTE, GUILD_CREST_PALETTE_IDS,
    type GuildCrestEmblemId, type GuildCrestPaletteId,
} from '@raid-ledger/contract';
import { CREST_EMBLEMS } from './crest-emblems';
import { HubCrest } from './hub-crest';
import { optionName } from './crest-picker-copy';
import { presetColoursClash, type PresetDraft } from './crest-picker-draft';
import { SwatchRadios, type SwatchOption } from './crest-swatch-radios';

function EmblemArt({ id }: { id: GuildCrestEmblemId }): JSX.Element {
    const art = CREST_EMBLEMS[id];
    return (
        <svg viewBox={art.viewBox} className="h-7 w-7 text-foreground" aria-hidden="true">
            {art.paths.map((d) => <path key={d} d={d} fill="currentColor" />)}
        </svg>
    );
}

const EMBLEM_OPTIONS: readonly SwatchOption<GuildCrestEmblemId>[] = GUILD_CREST_EMBLEM_IDS.map((id) => ({
    value: id, label: optionName(id), swatch: <EmblemArt id={id} />,
}));

const COLOUR_OPTIONS: readonly SwatchOption<GuildCrestPaletteId>[] = GUILD_CREST_PALETTE_IDS.map((id) => ({
    value: id, label: optionName(id),
    swatch: <span className="h-6 w-6 rounded-full" style={{ backgroundColor: GUILD_CREST_PALETTE[id] }} />,
}));

interface CrestPresetSectionProps {
    preset: PresetDraft;
    name: string;
    onChange: (patch: Partial<PresetDraft>) => void;
}

function PresetPreview({ preset, name }: { preset: PresetDraft; name: string }): JSX.Element {
    const crest = { source: 'preset' as const, ...preset };
    return (
        <div className="flex items-center gap-3" data-testid="crest-preset-preview">
            <HubCrest crest={crest} name={name} size="hero" />
            <HubCrest crest={crest} name={name} size="sm" />
            <span className="text-xs text-muted">Preview at hero and menu size</span>
        </div>
    );
}

/** Emblem + colours; the clash message is the fg ≠ bg guard's visible half (Save is disabled too). */
export function CrestPresetSection({ preset, name, onChange }: CrestPresetSectionProps): JSX.Element {
    const clash = presetColoursClash(preset);
    return (
        <div className="flex flex-col gap-4">
            <SwatchRadios legend="Emblem" name="crest-emblem" options={EMBLEM_OPTIONS} value={preset.emblemId}
                onChange={(emblemId) => onChange({ emblemId })} cellClassName="h-11 w-11 bg-surface" testId="crest-emblem-grid" />
            <SwatchRadios legend="Emblem colour" name="crest-fg" options={COLOUR_OPTIONS} value={preset.fg}
                onChange={(fg) => onChange({ fg })} cellClassName="h-9 w-9 rounded-full" testId="crest-fg-swatches" />
            <SwatchRadios legend="Background colour" name="crest-bg" options={COLOUR_OPTIONS} value={preset.bg}
                onChange={(bg) => onChange({ bg })} cellClassName="h-9 w-9 rounded-full" testId="crest-bg-swatches" />
            {clash && <p role="alert" className="text-sm text-danger" data-testid="crest-colour-clash">Pick different emblem and background colours.</p>}
            {!clash && <PresetPreview preset={preset} name={name} />}
            <p className="text-xs text-dim" data-testid="crest-credit">{GUILD_CREST_EMBLEM_CREDIT_LINE}</p>
        </div>
    );
}
