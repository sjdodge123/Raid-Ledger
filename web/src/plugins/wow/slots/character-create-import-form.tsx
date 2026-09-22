import { useState, useEffect, useMemo, useId } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';
import { useSystemStatus } from '../../../hooks/use-system-status';
import { useEventVariantContext } from '../../../hooks/use-events';
import { isWowSlug, FIXED_CLASSIC_VARIANTS } from '../utils';
import { isArmoryImportSupported, ARMORY_CLASSIC_VARIANTS, defaultArmoryClassicVariant } from '../lib/armory-import';
import { ArmoryUnavailableNote, DISABLED_TAB_CLS } from '../components/armory-unavailable-note';

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

function importTabCls(activeTab: Tab, disabled: boolean): string {
    if (disabled) return DISABLED_TAB_CLS;
    return activeTab === 'import' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-muted hover:text-secondary';
}

/** ROK-1636: `noteId` set = Armory unavailable for this variant — tab is aria-disabled and described by the note. */
function TabToggle({ activeTab, onTabChange, noteId }: { activeTab: Tab; onTabChange: (tab: Tab) => void; noteId?: string }) {
    return (
        <div className="flex rounded-lg bg-panel/50 border border-edge p-1">
            <button type="button" onClick={() => onTabChange('manual')}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'manual' ? 'bg-overlay text-foreground' : 'text-muted hover:text-secondary'}`}>Manual</button>
            <button type="button" onClick={() => { if (!noteId) onTabChange('import'); }} aria-disabled={noteId ? true : undefined} aria-describedby={noteId}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${importTabCls(activeTab, !!noteId)}`}>Import from Armory</button>
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
        <div>
            <label className="block text-sm font-medium text-secondary mb-1">Game Version</label>
            <select value={wowVariant} onChange={(e) => onVariantChange(e.target.value)}
                className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                {gameSlug === 'world-of-warcraft-classic' ? (
                    ARMORY_CLASSIC_VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)
                ) : <option value="retail">Retail (Live)</option>}
            </select>
        </div>
    );
}

function BlizzardNotConfigured() {
    return (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <p className="text-sm text-amber-400">Blizzard API not configured — ask an admin to set it up in Plugins.</p>
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
