import { useState, useEffect } from 'react';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';
import { useSystemStatus } from '../../../hooks/use-system-status';

const WOW_SLUGS = new Set(['wow', 'wow-classic', 'world-of-warcraft', 'world-of-warcraft-classic']);

function isWowSlug(slug: string): boolean {
    return WOW_SLUGS.has(slug) || slug.includes('world-of-warcraft');
}

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
    const systemStatus = useSystemStatus();
    const blizzardConfigured = systemStatus.data?.blizzardConfigured ?? false;

    const [wowVariant, setWowVariant] = useState<string>(() => {
        if (gameSlug === 'wow-classic' || gameSlug.includes('world-of-warcraft-classic')) {
            return 'classic_anniversary';
        }
        return 'retail';
    });

    // Default to import tab when Blizzard is configured
    useEffect(() => {
        if (blizzardConfigured) {
            onTabChange('import');
        }
    }, [blizzardConfigured, onTabChange]);

    // Only show Armory import for WoW games
    if (!isWowSlug(gameSlug)) return null;

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

            {/* Variant selector (only when import tab active and Blizzard configured) */}
            {activeTab === 'import' && blizzardConfigured && (
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

            {/* Import form or config warning */}
            {activeTab === 'import' && (
                blizzardConfigured ? (
                    <WowArmoryImportForm onSuccess={onClose} gameVariant={wowVariant} />
                ) : (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                        <p className="text-sm text-amber-400">
                            Blizzard API not configured — ask an admin to set it up in Plugins.
                        </p>
                    </div>
                )
            )}
        </>
    );
}
