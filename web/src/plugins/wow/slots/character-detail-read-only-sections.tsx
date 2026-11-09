/**
 * ROK-2149 — the WoW sections of a read-only roster member on the shared
 * character page. Everything renders from the payload: Equipment (+ item
 * modal), Talents and Professions (never editable). Quests, Saved instances
 * and Guild recommends are character-id-keyed, so they are not mounted, and no
 * query is keyed by the synthetic `roster-member:<id>` id. With no verified
 * Armory snapshot, a quiet note replaces Equipment and Talents/Professions hide.
 */
import type { JSX } from 'react';
import type { CharacterDto, RosterMemberNoArmoryReason } from '@raid-ledger/contract';
import { NO_ARMORY_COPY } from './no-armory-copy';
import { professionsPillSource } from '../lib/wow-variant-config';
import { useCharacterWowVariant } from '../hooks/use-character-wow-variant';
import { useWowheadTooltips } from '../hooks/use-wowhead-tooltips';
import { CharacterProfessionsPanel } from '../components/CharacterProfessionsPanel';
import {
    EquipmentEmptyState, EquipmentWithItems, SectionsLayout, TalentSection,
    VariantPendingSections, type SectionPanels,
} from './character-detail-panels';
import { renderSlotPortrait } from './render-slot-portrait';
import type { CharacterDetailSectionsProps } from './character-detail-sections';

export function NoArmoryNote({ reason }: { reason: RosterMemberNoArmoryReason }): JSX.Element {
    return (
        <div data-testid="roster-member-no-armory" className="bg-panel border border-edge rounded-lg p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
            <div className="text-center py-8">
                <p className="text-sm font-medium text-foreground">No Armory data</p>
                <p className="text-sm text-muted mt-1">{NO_ARMORY_COPY[reason]}</p>
            </div>
        </div>
    );
}

const NO_CHARACTER_PANELS = { quests: null, lockouts: null, addons: null } as const;

type ReadOnlyProps = CharacterDetailSectionsProps & { character: CharacterDto; noArmoryReason: RosterMemberNoArmoryReason | null };

export function ReadOnlyCharacterSections(props: ReadOnlyProps): JSX.Element {
    const { equipment, talents, professions, gameVariant, renderUrl, isArmoryImported, characterClass, gameId, character, noArmoryReason } = props;
    useWowheadTooltips(equipment ? [equipment] : []);
    const { variant, isResolving } = useCharacterWowVariant({ gameVariant, ruleset: character.ruleset, gameId });
    if (noArmoryReason) {
        return <SectionsLayout panels={{ equipment: <NoArmoryNote reason={noArmoryReason} />, talents: null, professions: null, ...NO_CHARACTER_PANELS }} />;
    }
    const portrait = renderSlotPortrait(character, variant, renderUrl);
    const panels: SectionPanels = {
        equipment: isResolving ? <VariantPendingSections /> : equipment
            ? <EquipmentWithItems equipment={equipment} gameVariant={variant} renderUrl={renderUrl} portrait={portrait} isArmoryImported={isArmoryImported} />
            : <EquipmentEmptyState isArmoryImported={isArmoryImported} gameVariant={variant} />,
        talents: isResolving ? null : <TalentSection talents={talents} isArmoryImported={isArmoryImported} characterClass={characterClass} gameVariant={variant} />,
        professions: <CharacterProfessionsPanel professions={professions} isOwner={false} characterId={character.id} gameId={gameId}
            source={professionsPillSource(variant, character.professionsSource)} />,
        ...NO_CHARACTER_PANELS,
    };
    return <SectionsLayout panels={panels} />;
}
