import { useState } from 'react';
import { WowArmoryImportForm } from '../../../components/characters/wow-armory-import-form';

interface CharacterCreateImportFormProps {
    onClose: () => void;
    gameSlug: string;
    activeTab: 'manual' | 'import';
    onTabChange: (tab: 'manual' | 'import') => void;
}

export function CharacterCreateImportForm({
    onClose,
    gameSlug,
    activeTab,
    onTabChange,
}: CharacterCreateImportFormProps) {
    const [wowVariant, setWowVariant] = useState<string>(() => {
        if (gameSlug === 'wow-classic' || gameSlug.includes('world-of-warcraft-classic')) {
            return 'classic_anniversary';
        }
        return 'retail';
    });

    return (
        <>
            {/* Tab toggle */}
            <div className="flex rounded-lg bg-panel/50 border border-edge p-1">
                <button
                    type="button"
                    onClick={() => onTabChange('manual')}
                    className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        activeTab === 'manual'
                            ? 'bg-overlay text-foreground'
                            : 'text-muted hover:text-secondary'
                    }`}
                >
                    Manual
                </button>
                <button
                    type="button"
                    onClick={() => onTabChange('import')}
                    className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        activeTab === 'import'
                            ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                            : 'text-muted hover:text-secondary'
                    }`}
                >
                    Import from Armory
                </button>
            </div>

            {/* Variant selector (only when import tab active) */}
            {activeTab === 'import' && (
                <div>
                    <label className="block text-sm font-medium text-secondary mb-1">
                        Game Version
                    </label>
                    <select
                        value={wowVariant}
                        onChange={(e) => setWowVariant(e.target.value)}
                        className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                        {gameSlug === 'wow-classic' || gameSlug.includes('world-of-warcraft-classic') ? (
                            <>
                                <option value="classic_anniversary">Classic Anniversary (TBC)</option>
                                <option value="classic_era">Classic Era / SoD</option>
                                <option value="classic">Classic (Cata)</option>
                            </>
                        ) : (
                            <option value="retail">Retail (Live)</option>
                        )}
                    </select>
                </div>
            )}

            {/* Import form (replaces manual form when import tab active) */}
            {activeTab === 'import' && (
                <WowArmoryImportForm onSuccess={onClose} gameVariant={wowVariant} />
            )}
        </>
    );
}
