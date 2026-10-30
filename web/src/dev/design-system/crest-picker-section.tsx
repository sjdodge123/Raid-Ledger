/**
 * ROK-1814 — /dev/design-system demo of the crest picker's Emblem body
 * (`CrestPresetSection`, the bulk of `CrestPicker`) and the `SwatchRadios`
 * primitive it is built from. The full `CrestPicker` needs a hub's editor
 * state from the API, so the demo mounts its preset body on local state.
 * Lazy (own chunk): the picker draws every emblem, so its art must not join
 * the DesignSystemPage chunk.
 */
import { useState, type JSX } from 'react';
import { GUILD_CREST_PALETTE, GUILD_CREST_PALETTE_IDS, type GuildCrestPaletteId } from '@raid-ledger/contract';
import { CrestPresetSection } from '../../components/hub/crest/crest-picker-preset';
import type { PresetDraft } from '../../components/hub/crest/crest-picker-draft';
import { SwatchRadios, type SwatchOption } from '../../components/hub/crest/crest-swatch-radios';
import { Section, StateFrame } from './design-system-bits';

const SWATCHES: readonly SwatchOption<GuildCrestPaletteId>[] = GUILD_CREST_PALETTE_IDS.slice(0, 4).map((id) => ({
    value: id, label: id,
    swatch: <span className="h-6 w-6 rounded-full" style={{ backgroundColor: GUILD_CREST_PALETTE[id] }} />,
}));

function SwatchDemo(): JSX.Element {
    const [value, setValue] = useState<GuildCrestPaletteId>(SWATCHES[0]?.value ?? 'or');
    return (
        <SwatchRadios legend="Colour" name="ds-swatch-demo" options={SWATCHES} value={value} onChange={setValue}
            cellClassName="h-9 w-9 rounded-full" testId="ds-swatch-radios" />
    );
}

function PresetDemo(): JSX.Element {
    const [preset, setPreset] = useState<PresetDraft>({ emblemId: 'dragon-head', fg: 'or', bg: 'gules' });
    return <CrestPresetSection preset={preset} name="Order of the Ember" onChange={(p) => setPreset((cur) => ({ ...cur, ...p }))} />;
}

/** SwatchRadios alone, then the picker's Emblem body (emblem grid, fg/bg swatches, preview, clash guard). */
export function CrestPickerSection(): JSX.Element {
    return (
        <Section id="crest-picker" title="Crest picker — CrestPicker + SwatchRadios"
            blurb="§3.2 CrestPicker (editor-only; Modal ≥1024px, BottomSheet below) and SwatchRadios — a visual one-of-N radio grid. Pick the same emblem and background colour to see the clash guard.">
            <div className="grid gap-4" data-testid="ds-crest-picker">
                <StateFrame label="SwatchRadios" note="crest-swatch-radios.tsx — native radios, Tab/arrow keys, ON = border-success ring.">
                    <SwatchDemo />
                </StateFrame>
                <StateFrame label="CrestPicker — Emblem tab body" note="crest-picker-preset.tsx on local state; the Upload and Gallery tabs need a hub.">
                    <PresetDemo />
                </StateFrame>
            </div>
        </Section>
    );
}
