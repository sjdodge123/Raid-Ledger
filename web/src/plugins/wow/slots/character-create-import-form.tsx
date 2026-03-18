import { useState, useEffect, useMemo } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';
import { useSystemStatus } from '../../../hooks/use-system-status';
import { useEventVariantContext } from '../../../hooks/use-events';
import { isWowSlug, FIXED_CLASSIC_VARIANTS } from '../utils';

interface CharacterCreateImportFormProps {
    onClose: () => void;
    gameSlug: string;
    activeTab: 'manual' | 'import';
    onTabChange: (tab: 'manual' | 'import') => void;
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
        : fixedVariant ?? userVariant ?? variantContext?.gameVariant ?? 'classic_anniversary';
    const variantIsMain = useMemo(() => !existingCharacters.some((c) => c.isMain && c.gameVariant === wowVariant), [existingCharacters, wowVariant]);
    return { isClassic, showVariantSelector: isClassic && !fixedVariant, wowVariant, setUserVariant, variantIsMain };
}

function TabToggle({ activeTab, onTabChange }: { activeTab: 'manual' | 'import'; onTabChange: (tab: 'manual' | 'import') => void }) {
    return (
        <div className="flex rounded-lg bg-panel/50 border border-edge p-1">
            <button type="button" onClick={() => onTabChange('manual')}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'manual' ? 'bg-overlay text-foreground' : 'text-muted hover:text-secondary'}`}>Manual</button>
            <button type="button" onClick={() => onTabChange('import')}
                className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'import' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-muted hover:text-secondary'}`}>Import from Armory</button>
        </div>
    );
}

function VariantSelector({ wowVariant, gameSlug, onVariantChange }: { wowVariant: string; gameSlug: string; onVariantChange: (v: string) => void }) {
    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-1">Game Version</label>
            <select value={wowVariant} onChange={(e) => onVariantChange(e.target.value)}
                className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                {gameSlug === 'world-of-warcraft-classic' ? (
                    <>
                        <option value="classic_anniversary">Classic Anniversary (TBC)</option>
                        <option value="classic_era">Classic Era / SoD</option>
                        <option value="classic">Classic (Cata)</option>
                    </>
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

    useEffect(() => { if (blizzardConfigured) onTabChange('import'); }, [blizzardConfigured, onTabChange]);
    if (!isWowSlug(gameSlug)) return null;

    return (
        <>
            <TabToggle activeTab={activeTab} onTabChange={onTabChange} />
            {activeTab === 'import' && blizzardConfigured && showVariantSelector && <VariantSelector wowVariant={wowVariant} gameSlug={gameSlug} onVariantChange={setUserVariant} />}
            {activeTab === 'import' && (blizzardConfigured
                ? <WowArmoryImportForm onSuccess={onClose} gameVariant={wowVariant} isMain={variantIsMain} onRegisterValidator={onRegisterValidator} />
                : <BlizzardNotConfigured />)}
        </>
    );
}
