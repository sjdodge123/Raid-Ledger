import { useState, useEffect, useMemo, useId } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';
import { useSystemStatus } from '../../../hooks/use-system-status';
import { useEventVariantContext } from '../../../hooks/use-events';
import { isWowSlug, FIXED_CLASSIC_VARIANTS } from '../utils';
import { isArmoryImportSupported, ARMORY_CLASSIC_VARIANTS, defaultArmoryClassicVariant } from '../lib/armory-import';
import { ArmoryUnavailableNote, ARMORY_TAB_CLS, ARMORY_TAB_TRACK_CLS } from '../components/armory-unavailable-note';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';

interface CharacterCreateImportFormProps {
    onClose: () => void;
    gameSlug: string;
    activeTab: Tab;
    onTabChange: (tab: Tab) => void;
    existingCharacters?: CharacterDto[];
    onRegisterValidator?: (fn: () => boolean) => void;
    /** ROK-587: Event ID for variant context auto-population */
    eventId?: number;
}

/** Check if the slug is for any WoW Classic variant (including world-of-warcraft-classic). */
function isClassicSlug(slug: string): boolean {
    return slug === 'world-of-warcraft-classic' || slug in FIXED_CLASSIC_VARIANTS;
}

function useImportFormVariant(gameSlug: string, eventId: number | undefined, existingCharacters: CharacterDto[]) {
    const isClassic = isClassicSlug(gameSlug);
    const fixedVariant = FIXED_CLASSIC_VARIANTS[gameSlug] ?? null;
    const { data: variantContext } = useEventVariantContext(eventId, isClassic && !fixedVariant && !!eventId);
    const [userVariant, setUserVariant] = useState<string | null>(null);
    const wowVariant = !isClassic ? 'retail'
        : fixedVariant ?? userVariant ?? defaultArmoryClassicVariant(variantContext?.gameVariant);
    const variantIsMain = useMemo(() => !existingCharacters.some((c) => c.isMain && c.gameVariant === wowVariant), [existingCharacters, wowVariant]);
    return { isClassic, showVariantSelector: isClassic && !fixedVariant, wowVariant, setUserVariant, variantIsMain };
}

type Tab = 'manual' | 'import';

/** ROK-1636: `noteId` set = Armory unavailable for this variant — tab is aria-disabled and described by the note. */
function TabToggle({ activeTab, onTabChange, noteId }: { activeTab: Tab; onTabChange: (tab: Tab) => void; noteId?: string }) {
    return (
        <div role="group" aria-label="Add character by" className={ARMORY_TAB_TRACK_CLS}>
            <Button variant="ghost" size="sm" className={ARMORY_TAB_CLS} aria-pressed={activeTab === 'manual'}
                onClick={() => onTabChange('manual')}>Manual</Button>
            <Button variant="ghost" size="sm" className={ARMORY_TAB_CLS} aria-pressed={activeTab === 'import'}
                onClick={() => { if (!noteId) onTabChange('import'); }} aria-disabled={noteId ? true : undefined} aria-describedby={noteId}>
                Import from Armory
            </Button>
        </div>
    );
}

/** Default to Armory when Blizzard is configured; force Manual when the variant has no Armory (ROK-1636). */
function useArmoryTabSync(blizzardConfigured: boolean, armoryOk: boolean, activeTab: Tab, onTabChange: (tab: Tab) => void) {
    useEffect(() => { if (blizzardConfigured && armoryOk) onTabChange('import'); }, [blizzardConfigured, armoryOk, onTabChange]);
    useEffect(() => { if (!armoryOk && activeTab === 'import') onTabChange('manual'); }, [armoryOk, activeTab, onTabChange]);
}

function VariantSelector({ wowVariant, gameSlug, onVariantChange }: { wowVariant: string; gameSlug: string; onVariantChange: (v: string) => void }) {
    return (
        <Field label="Game version">
            <Select value={wowVariant} onChange={(e) => onVariantChange(e.target.value)}>
                {gameSlug === 'world-of-warcraft-classic' ? (
                    ARMORY_CLASSIC_VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)
                ) : <option value="retail">Retail (Live)</option>}
            </Select>
        </Field>
    );
}

function BlizzardNotConfigured() {
    return (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
            <p className="text-sm text-warning">Blizzard API not configured — ask an admin to set it up in Plugins.</p>
        </div>
    );
}

export function CharacterCreateImportForm({
    onClose, gameSlug, activeTab, onTabChange, existingCharacters = [], onRegisterValidator, eventId,
}: CharacterCreateImportFormProps) {
    const systemStatus = useSystemStatus();
    const blizzardConfigured = systemStatus.data?.blizzardConfigured ?? false;
    const { showVariantSelector, wowVariant, setUserVariant, variantIsMain } = useImportFormVariant(gameSlug, eventId, existingCharacters);

    const armoryOk = isArmoryImportSupported(wowVariant);
    const noteId = useId();
    useArmoryTabSync(blizzardConfigured, armoryOk, activeTab, onTabChange);
    if (!isWowSlug(gameSlug)) return null;
    const showImport = activeTab === 'import' && armoryOk;

    return (
        <>
            <TabToggle activeTab={activeTab} onTabChange={onTabChange} noteId={armoryOk ? undefined : noteId} />
            {!armoryOk && <ArmoryUnavailableNote id={noteId} />}
            {showImport && blizzardConfigured && showVariantSelector && <VariantSelector wowVariant={wowVariant} gameSlug={gameSlug} onVariantChange={setUserVariant} />}
            {showImport && (blizzardConfigured
                ? <WowArmoryImportForm onSuccess={onClose} gameVariant={wowVariant} isMain={variantIsMain} onRegisterValidator={onRegisterValidator} />
                : <BlizzardNotConfigured />)}
        </>
    );
}
