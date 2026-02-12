import { useState } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';

interface CharacterCreateInlineImportProps {
    onSuccess?: (character?: CharacterDto) => void;
    isMain?: boolean;
    gameSlug?: string;
}

const WOW_SLUGS = new Set(['wow', 'wow-classic', 'world-of-warcraft', 'world-of-warcraft-classic']);

function isWowSlug(slug: string): boolean {
    return WOW_SLUGS.has(slug) || slug.includes('world-of-warcraft');
}

/**
 * Inline import slot: renders mode toggle + WowArmoryImportForm
 * inside the InlineCharacterForm context (signup confirmation modal etc).
 */
export function CharacterCreateInlineImport({
    onSuccess,
    isMain,
    gameSlug,
}: CharacterCreateInlineImportProps) {
    const [mode, setMode] = useState<'manual' | 'import'>('import');

    if (!gameSlug || !isWowSlug(gameSlug)) return null;

    const gameVariant = gameSlug === 'wow-classic' || gameSlug.includes('world-of-warcraft-classic')
        ? 'classic_era' : 'retail';

    return (
        <>
            {/* Mode toggle */}
            <div className="flex rounded-lg bg-panel/50 border border-edge p-1">
                <button
                    type="button"
                    onClick={() => setMode('import')}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        mode === 'import'
                            ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                            : 'text-muted hover:text-secondary'
                    }`}
                >
                    Import from Armory
                </button>
                <button
                    type="button"
                    onClick={() => setMode('manual')}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        mode === 'manual'
                            ? 'bg-overlay text-foreground'
                            : 'text-muted hover:text-secondary'
                    }`}
                >
                    Manual
                </button>
            </div>

            {mode === 'import' && (
                <WowArmoryImportForm
                    isMain={isMain}
                    gameVariant={gameVariant}
                    onSuccess={() => {
                        onSuccess?.(undefined as unknown as CharacterDto);
                    }}
                />
            )}

            {/* When mode === 'manual', render nothing — the parent form handles manual mode */}
        </>
    );
}
