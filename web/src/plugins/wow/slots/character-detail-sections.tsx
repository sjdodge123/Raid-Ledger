/**
 * Character detail sections: equipment grid and talents display.
 * Props passed via PluginSlot context from character-detail-page.
 *
 * ROK-1726: the effective WoW variant is resolved ONCE here (D6) and passed
 * to the grid, the item modal, talents and the empty states. Manual WoW:
 * Forever characters carry `gameVariant: null` + a `ruleset`; the ruleset is
 * read from the page's own character query (same cache key, no extra
 * request), so core's slot context needs no WoW field. ROK-1751: the game
 * slug (from the cached game registry) resolves LedgerLink Forever characters
 * whose ruleset is null; while the registry is still loading, neutral
 * panels render instead of variant-specific copy. ROK-1743: Forever saved
 * instances (`character.lockouts`, addon snapshot) render after Quests.
 * ROK-2146 (layout A): at >= lg a main column (Equipment, Talents, Quests) and
 * a 320px sidebar (Professions, Saved instances, Guild recommends); below lg one
 * stack in the order Equipment, Talents, Professions, Saved instances, Quests,
 * Guild recommends. ONE tree at every width, laid out in CSS only, so crossing lg
 * (resize, tablet rotate) never remounts a panel or drops its state (Codex P2).
 */
import { lazy, Suspense } from 'react';
import type { CharacterDto, CharacterEquipmentDto, CharacterProfessionsDto, RosterMemberNoArmoryReason } from '@raid-ledger/contract';
import { useCharacterDetail } from '../../../hooks/use-character-detail';
import { professionsPillSource } from '../lib/wow-variant-config';
import { useCharacterWowVariant } from '../hooks/use-character-wow-variant';
import { useWowheadTooltips } from '../hooks/use-wowhead-tooltips';
import { CharacterProfessionsPanel } from '../components/CharacterProfessionsPanel';
import { CharacterQuestsSection } from '../components/character-quests-section';
import { CharacterLockoutsSection } from '../components/character-lockouts-section';
import {
    EquipmentEmptyState, EquipmentWithItems, SectionsLayout, TalentSection,
    VariantPendingSections, type SectionPanels,
} from './character-detail-panels';
import { renderSlotPortrait } from './render-slot-portrait';
import { ReadOnlyCharacterSections } from './character-detail-read-only-sections';

/** ROK-1786: lazy so the guild addons card stays out of the entry chunk. */
const CharacterAddonsCard = lazy(() => import('./character-addons-card').then((m) => ({ default: m.CharacterAddonsCard })));

/** Props passed via PluginSlot context from character-detail-page */
export interface CharacterDetailSectionsProps {
    equipment: CharacterEquipmentDto | null;
    talents: unknown;
    professions: CharacterProfessionsDto | null;
    gameVariant: string | null;
    renderUrl: string | null;
    isArmoryImported: boolean;
    characterClass: string | null;
    isOwner: boolean;
    characterId: string;
    gameId: number;
    /** ROK-2149: set on a read-only roster member — render from it, never fetch by `characterId`. */
    readOnlyCharacter?: CharacterDto | undefined;
    /** ROK-2149: why the read-only member has no Armory data. */
    noArmoryReason?: RosterMemberNoArmoryReason | null | undefined;
}

/**
 * The `character-detail:sections` filler. ROK-2149: a read-only roster member
 * gets the read-only sections (no Quests, Saved instances or Guild recommends,
 * nothing fetched by character id); every real character the owned sections.
 */
export function CharacterDetailSections(props: CharacterDetailSectionsProps) {
    return props.readOnlyCharacter
        ? <ReadOnlyCharacterSections {...props} character={props.readOnlyCharacter} noArmoryReason={props.noArmoryReason ?? null} />
        : <OwnedCharacterSections {...props} />;
}

/** A real character's sections (unchanged before ROK-2149). */
function OwnedCharacterSections({
    equipment, talents, professions, gameVariant,
    renderUrl, isArmoryImported, characterClass,
    isOwner, characterId, gameId,
}: CharacterDetailSectionsProps) {
    useWowheadTooltips(equipment ? [equipment] : []);
    const { data: character } = useCharacterDetail(characterId);
    const { variant, isResolving } = useCharacterWowVariant({ gameVariant, ruleset: character?.ruleset, gameId });
    const portrait = renderSlotPortrait(character, variant, renderUrl);

    const panels: SectionPanels = {
        equipment: isResolving ? <VariantPendingSections /> : equipment ? (
            <EquipmentWithItems equipment={equipment} gameVariant={variant}
                renderUrl={renderUrl} portrait={portrait} isArmoryImported={isArmoryImported} />
        ) : <EquipmentEmptyState isArmoryImported={isArmoryImported} gameVariant={variant} />,
        talents: isResolving ? null : <TalentSection talents={talents} isArmoryImported={isArmoryImported}
            characterClass={characterClass} gameVariant={variant} />,
        quests: <CharacterQuestsSection characterId={characterId} variant={variant} />,
        professions: <CharacterProfessionsPanel professions={professions}
            isOwner={isOwner} characterId={characterId} gameId={gameId}
            source={professionsPillSource(variant, character?.professionsSource)} />,
        lockouts: <CharacterLockoutsSection lockouts={character?.lockouts} />,
        addons: <Suspense fallback={null}><CharacterAddonsCard characterId={characterId} /></Suspense>,
    };
    return <SectionsLayout panels={panels} />;
}

