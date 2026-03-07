/**
 * Character preview card shown after searching the Blizzard Armory.
 * Displays character info with faction theming and action buttons.
 */
import type { BlizzardCharacterPreviewDto } from '@raid-ledger/contract';

/** Props for the character preview card */
export interface CharacterPreviewCardProps {
    preview: BlizzardCharacterPreviewDto;
    setAsMain: boolean;
    onSetAsMainChange: (v: boolean) => void;
    onImport: () => void;
    onBack: () => void;
    isImporting: boolean;
    error: string;
    /** When true, pulse the action buttons to draw attention */
    highlightActions?: boolean;
}

/** Character preview card with faction styling and import actions */
export function CharacterPreviewCard({
    preview, setAsMain, onSetAsMainChange,
    onImport, onBack, isImporting, error, highlightActions,
}: CharacterPreviewCardProps) {
    const factionColor = preview.faction === 'alliance' ? 'text-blue-400' : 'text-red-400';
    const factionBg = preview.faction === 'alliance'
        ? 'bg-blue-900/30 border-blue-700/40'
        : 'bg-red-900/30 border-red-700/40';
    const roleEmoji = preview.role === 'tank' ? '🛡️' : preview.role === 'healer' ? '💚' : '⚔️';

    return (
        <div className="space-y-2">
            <div className={`rounded-lg border overflow-hidden ${factionBg}`}>
                <div className="flex">
                    <CharacterInfoSection preview={preview} factionColor={factionColor} factionBg={factionBg} roleEmoji={roleEmoji} />
                    <ActionButtons
                        setAsMain={setAsMain} onSetAsMainChange={onSetAsMainChange}
                        onImport={onImport} onBack={onBack}
                        isImporting={isImporting} highlightActions={highlightActions}
                    />
                </div>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
    );
}

function CharacterNameLine({ preview, factionColor, factionBg }: { preview: BlizzardCharacterPreviewDto; factionColor: string; factionBg: string }) {
    return (
        <div className="flex items-center gap-2">
            <h3 className="text-foreground font-bold text-lg truncate">{preview.name}</h3>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${factionColor} ${factionBg}`}>
                {preview.faction.charAt(0).toUpperCase() + preview.faction.slice(1)}
            </span>
        </div>
    );
}

/** Character info section with avatar, name, class/race details */
function CharacterInfoSection({ preview, factionColor, factionBg, roleEmoji }: {
    preview: BlizzardCharacterPreviewDto; factionColor: string; factionBg: string; roleEmoji: string;
}) {
    return (
        <div className="flex-1 min-w-0 flex flex-col">
            <div className="p-3">
                <div className="flex gap-3">
                    <CharacterAvatar preview={preview} />
                    <div className="flex-1 min-w-0">
                        <CharacterNameLine preview={preview} factionColor={factionColor} factionBg={factionBg} />
                        <p className="text-secondary text-sm">{preview.realm}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm">
                            <span className="text-muted">{preview.race}</span>
                            <span className="text-foreground font-medium">{preview.class}</span>
                            {preview.spec && <span className="text-secondary">{preview.spec}{preview.role && <span className="ml-1">{roleEmoji}</span>}</span>}
                        </div>
                    </div>
                </div>
            </div>
            <CharacterFooterStats preview={preview} />
        </div>
    );
}

/** Character avatar with fallback */
function CharacterAvatar({ preview }: { preview: BlizzardCharacterPreviewDto }) {
    if (preview.avatarUrl) {
        return (
            <img
                src={preview.avatarUrl} alt={preview.name}
                className="w-16 h-16 rounded-lg object-cover border border-edge/50"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
        );
    }
    return (
        <div className="w-16 h-16 rounded-lg bg-overlay flex items-center justify-center text-2xl border border-edge/50">
            ⚔️
        </div>
    );
}

/** Footer stats: level, item level, armory link */
function CharacterFooterStats({ preview }: { preview: BlizzardCharacterPreviewDto }) {
    return (
        <div className="flex items-center gap-4 px-3 py-2 border-t border-edge/30 mt-auto">
            <div className="text-sm">
                <span className="text-muted">Level </span>
                <span className="text-foreground font-medium">{preview.level}</span>
            </div>
            {preview.itemLevel && (
                <div className="text-sm">
                    <span className="text-muted">iLvl </span>
                    <span className="text-amber-400 font-medium">{preview.itemLevel}</span>
                </div>
            )}
            {preview.profileUrl && (
                <a href={preview.profileUrl} target="_blank" rel="noopener noreferrer"
                    className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors">
                    Armory &rarr;
                </a>
            )}
        </div>
    );
}

function MainToggleButton({ setAsMain, onSetAsMainChange }: { setAsMain: boolean; onSetAsMainChange: (v: boolean) => void }) {
    return (
        <button type="button" onClick={() => onSetAsMainChange(!setAsMain)}
            title={setAsMain ? 'Will be set as main character' : 'Click to set as main'}
            className={`w-16 flex flex-col items-center justify-center gap-0.5 border-r border-edge/20 font-semibold text-xs transition-all ${setAsMain ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' : 'bg-panel/30 text-muted hover:text-secondary hover:bg-panel/50'}`}>
            <span className="text-lg">{setAsMain ? '⭐' : '☆'}</span>
            <span>Main</span>
        </button>
    );
}

/** Action buttons: Main toggle, Dismiss, Save */
function ActionButtons({ setAsMain, onSetAsMainChange, onImport, onBack, isImporting, highlightActions }: {
    setAsMain: boolean; onSetAsMainChange: (v: boolean) => void;
    onImport: () => void; onBack: () => void; isImporting: boolean; highlightActions?: boolean;
}) {
    const hl = highlightActions ?? false;
    return (
        <div className="flex flex-shrink-0 border-l border-edge/30">
            <MainToggleButton setAsMain={setAsMain} onSetAsMainChange={onSetAsMainChange} />
            <button type="button" onClick={onBack} disabled={isImporting} aria-label="Dismiss" title="Dismiss"
                className={`w-16 flex items-center justify-center bg-red-600/15 border-r border-edge/20 text-red-400 hover:bg-red-600/30 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${hl ? 'animate-pulse bg-red-600/25 ring-inset ring-2 ring-red-400/60' : ''}`}>
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <button type="button" onClick={onImport} disabled={isImporting} aria-label="Save character" title="Save character"
                className={`w-16 flex items-center justify-center bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${hl ? 'animate-pulse ring-inset ring-2 ring-emerald-300/60' : ''}`}>
                {isImporting ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>}
            </button>
        </div>
    );
}
