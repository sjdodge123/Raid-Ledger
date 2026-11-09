import { useState, useEffect, useMemo, useId, useRef } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { WowArmoryImportForm } from '../components/wow-armory-import-form';
import { useSystemStatus } from '../../../hooks/use-system-status';
import { useEventVariantContext } from '../../../hooks/use-events';
import { isWowSlug, FIXED_CLASSIC_VARIANTS } from '../utils';
import { isArmoryImportSupported, armoryClassicVariants, defaultArmoryClassicVariant, type ArmoryCapabilities } from '../lib/armory-import';
import { useArmoryCapabilities } from '../hooks/use-armory-capabilities';
import { ArmoryUnavailableNote, ARMORY_TAB_CLS, ARMORY_TAB_TRACK_CLS } from '../components/armory-unavailable-note';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { RosterClaimList } from '../components/roster-claim-list';
import { useRosterClaimCandidates } from '../hooks/use-roster-claim';
import { countCandidates, shouldDefaultToRoster } from '../lib/roster-claim';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';

interface CharacterCreateImportFormProps {
    onClose: () => void;
    gameSlug: string;
    /** ROK-2128: the picked game's id — the Guild roster list is game-scoped. */
    gameId?: number | undefined;
    activeTab: Tab;
    onTabChange: (tab: Tab) => void;
    existingCharacters?: CharacterDto[];
    /** Codex P2: true while `existingCharacters` is still loading — not yet "no characters". */
    charactersLoading?: boolean;
    onRegisterValidator?: (fn: () => boolean) => void;
    /** ROK-587: Event ID for variant context auto-population */
    eventId?: number;
    /**
     * ROK-2132: the tab the caller asked to open on (the guild join gate opens `roster`).
     * Set → it wins over the automatic Armory / Guild roster defaults.
     */
    initialTab?: Tab | undefined;
    /** ROK-2132: narrow the Guild roster list to this guild ("Show all guilds" clears it). */
    rosterGuildId?: number | undefined;
}

/** Check if the slug is for any WoW Classic variant (including world-of-warcraft-classic). */
function isClassicSlug(slug: string): boolean {
    return slug === 'world-of-warcraft-classic' || slug in FIXED_CLASSIC_VARIANTS;
}

function useImportFormVariant(gameSlug: string, eventId: number | undefined, existingCharacters: CharacterDto[], caps: ArmoryCapabilities) {
    const isClassic = isClassicSlug(gameSlug);
    const fixedVariant = FIXED_CLASSIC_VARIANTS[gameSlug] ?? null;
    const { data: variantContext } = useEventVariantContext(eventId, isClassic && !fixedVariant && !!eventId);
    const [userVariant, setUserVariant] = useState<string | null>(null);
    const wowVariant = !isClassic ? 'retail'
        : fixedVariant ?? userVariant ?? defaultArmoryClassicVariant(variantContext?.gameVariant, caps);
    const variantIsMain = useMemo(() => !existingCharacters.some((c) => c.isMain && c.gameVariant === wowVariant), [existingCharacters, wowVariant]);
    return { isClassic, showVariantSelector: isClassic && !fixedVariant, wowVariant, setUserVariant, variantIsMain };
}

/** ROK-2128: `roster` = Add character → Guild roster (WoW: Forever only). */
type Tab = 'manual' | 'import' | 'roster';

/** ROK-1636: `noteId` set = Armory unavailable for this variant — tab is aria-disabled and described by the note. */
function TabToggle({ activeTab, onTabChange, noteId, showRoster }: {
    activeTab: Tab; onTabChange: (tab: Tab) => void; noteId?: string | undefined; showRoster: boolean;
}) {
    return (
        <div role="group" aria-label="Add character by" className={ARMORY_TAB_TRACK_CLS}>
            <Button variant="ghost" size="sm" className={ARMORY_TAB_CLS} aria-pressed={activeTab === 'manual'}
                onClick={() => onTabChange('manual')}>Manual</Button>
            <Button variant="ghost" size="sm" className={ARMORY_TAB_CLS} aria-pressed={activeTab === 'import'}
                onClick={() => { if (!noteId) onTabChange('import'); }} aria-disabled={noteId ? true : undefined} aria-describedby={noteId}>
                Import from Armory
            </Button>
            {showRoster && (
                <Button variant="ghost" size="sm" className={ARMORY_TAB_CLS} aria-pressed={activeTab === 'roster'}
                    onClick={() => onTabChange('roster')}>Guild roster</Button>
            )}
        </div>
    );
}

/**
 * Default to Armory when Blizzard is configured; force Manual when the variant has no Armory (ROK-1636).
 * ROK-2128 FLAG 9: never over the Guild roster default, whichever query resolves first.
 */
function useArmoryTabSync(blizzardConfigured: boolean, armoryOk: boolean, keepTab: boolean, activeTab: Tab, onTabChange: (tab: Tab) => void) {
    useEffect(() => { if (blizzardConfigured && armoryOk && !keepTab) onTabChange('import'); }, [blizzardConfigured, armoryOk, keepTab, onTabChange]);
    useEffect(() => { if (!armoryOk && activeTab === 'import') onTabChange('manual'); }, [armoryOk, activeTab, onTabChange]);
}

/**
 * ROK-2132 (Codex P2): an `initialTab` of `import` resolves once the capabilities have
 * loaded. While they load, Forever's Armory is fail-closed and the sync above falls back to
 * Manual; the moment they settle, the requested Import tab wins if it is available — once.
 */
function useRequestedImportTab(initialTab: Tab | undefined, capsSettled: boolean, armoryOk: boolean, onTabChange: (tab: Tab) => void) {
    const resolved = useRef(false);
    useEffect(() => {
        if (initialTab !== 'import' || !capsSettled || resolved.current) return;
        resolved.current = true;
        if (armoryOk) onTabChange('import');
    }, [initialTab, capsSettled, armoryOk, onTabChange]);
}

/**
 * ROK-2128: "Guild roster" exists only for WoW: Forever with ≥1 unclaimed candidate (FLAG 8);
 * it opens by default only for a user with no character of the game (FLAG 9), and an
 * emptied list falls back off the tab. ROK-2132: an `initialTab` of `roster` holds the tab
 * while the list loads (falling back only once it is known to be empty); any `initialTab`
 * turns the automatic default off.
 */
function useRosterTab(gameSlug: string, gameId: number | undefined, existing: CharacterDto[] | undefined, activeTab: Tab, onTabChange: (tab: Tab) => void, initialTab: Tab | undefined) {
    const isForever = gameSlug === WOW_FOREVER_GAME_SLUG;
    const { data } = useRosterClaimCandidates(gameId, isForever);
    const count = isForever ? countCandidates(data?.guilds ?? []) : 0;
    const known = !isForever || data !== undefined;
    const rosterDefault = initialTab === undefined
        ? existing !== undefined && shouldDefaultToRoster(existing, count)
        : initialTab === 'roster' && (!known || count > 0);
    useEffect(() => { if (rosterDefault) onTabChange('roster'); }, [rosterDefault, onTabChange]);
    useEffect(() => { if (known && count === 0 && activeTab === 'roster') onTabChange('manual'); }, [known, count, activeTab, onTabChange]);
    return { showRoster: count > 0, rosterDefault };
}

function VariantSelector({ wowVariant, gameSlug, caps, onVariantChange }: {
    wowVariant: string; gameSlug: string; caps: ArmoryCapabilities; onVariantChange: (v: string) => void;
}) {
    return (
        <Field label="Game version">
            <Select value={wowVariant} onChange={(e) => onVariantChange(e.target.value)}>
                {gameSlug === 'world-of-warcraft-classic' ? (
                    armoryClassicVariants(caps).map((v) => <option key={v.value} value={v.value}>{v.label}</option>)
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
    onClose, gameSlug, gameId, activeTab, onTabChange, existingCharacters = [], charactersLoading = false, onRegisterValidator, eventId, initialTab, rosterGuildId,
}: CharacterCreateImportFormProps) {
    const systemStatus = useSystemStatus();
    const blizzardConfigured = systemStatus.data?.blizzardConfigured ?? false;
    const { data: caps, isPending: capsPending } = useArmoryCapabilities();
    const { showVariantSelector, wowVariant, setUserVariant, variantIsMain } = useImportFormVariant(gameSlug, eventId, existingCharacters, caps);

    const armoryOk = isArmoryImportSupported(wowVariant, caps);
    const noteId = useId();
    const { showRoster, rosterDefault } = useRosterTab(gameSlug, gameId, charactersLoading ? undefined : existingCharacters, activeTab, onTabChange, initialTab);
    useArmoryTabSync(blizzardConfigured, armoryOk, rosterDefault || initialTab !== undefined, activeTab, onTabChange);
    useRequestedImportTab(initialTab, !capsPending, armoryOk, onTabChange);
    if (!isWowSlug(gameSlug)) return null;
    const showImport = activeTab === 'import' && armoryOk;

    return (
        <>
            <TabToggle activeTab={activeTab} onTabChange={onTabChange} noteId={armoryOk ? undefined : noteId} showRoster={showRoster} />
            {!armoryOk && <ArmoryUnavailableNote id={noteId} />}
            {showImport && blizzardConfigured && showVariantSelector && <VariantSelector wowVariant={wowVariant} gameSlug={gameSlug} caps={caps} onVariantChange={setUserVariant} />}
            {showImport && (blizzardConfigured
                ? <WowArmoryImportForm onSuccess={onClose} gameVariant={wowVariant} isMain={variantIsMain} onRegisterValidator={onRegisterValidator} />
                : <BlizzardNotConfigured />)}
            {activeTab === 'roster' && showRoster && gameId !== undefined && (
                <RosterClaimList key={charactersLoading ? 'loading' : 'ready'} gameId={gameId} existingCharacters={existingCharacters} armoryAvailable={armoryOk && blizzardConfigured}
                    guildId={rosterGuildId} onClaimed={onClose} onSwitchTab={onTabChange} />
            )}
        </>
    );
}
