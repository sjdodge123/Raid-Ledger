/**
 * Boss & Loot Preview Panel — shows boss encounter order and loot tables
 * for each content instance on the event detail page.
 *
 * ROK-247: Boss & Loot Preview on Events (Classic)
 */
import { useState, useMemo } from 'react';
import type { BossEncounterDto, EquipmentItemDto } from '@raid-ledger/contract';
import { useBossesForInstance, useLootForBoss } from '../hooks/use-boss-loot';
import { useWowheadTooltips } from '../hooks/use-wowhead-tooltips';
import { useCharacterDetail } from '../../../hooks/use-character-detail';
import { getWowheadNpcSearchUrl } from '../lib/wowhead-urls';
import { BossLootBody } from './boss-loot-body';
import './boss-loot-panel.css';
import './quest-prep-panel.css';

/**
 * Map game slug to WoW variant for the boss/loot API.
 * Handles both short legacy slugs and full ITAD-style variant slugs.
 * Falls back to classic_era for unknown slugs.
 */
function slugToVariant(gameSlug?: string): string {
    switch (gameSlug) {
        case 'wow-classic-anniversary':
        case 'world-of-warcraft-burning-crusade-classic-anniversary-edition':
            return 'classic_anniversary';
        case 'world-of-warcraft-classic':
        case 'wow-classic-era':
            return 'classic_era';
        case 'wow-classic':
        case 'wow-cata':
        case 'world-of-warcraft-burning-crusade-classic':
        case 'world-of-warcraft-wrath-of-the-lich-king':
            return 'classic';
        case 'wow-retail':
        case 'world-of-warcraft':
            return 'retail';
        default:
            return 'classic_era';
    }
}

/** Props passed via PluginSlot context from event-detail-page */
interface BossLootPanelProps {
    contentInstances: Record<string, unknown>[];
    eventId?: number;
    gameSlug?: string;
    characterId?: string;
}

function useContentInstances(contentInstances: Record<string, unknown>[]) {
    return useMemo(
        () => contentInstances
            .map((ci) => ({
                id: typeof ci.id === 'number' ? ci.id : Number(ci.id ?? ci.instanceId),
                name: typeof ci.name === 'string' ? ci.name : undefined,
            }))
            .filter((inst) => !isNaN(inst.id) && inst.id > 0),
        [contentInstances],
    );
}

function useEquippedBySlot(character: ReturnType<typeof useCharacterDetail>['data']) {
    return useMemo(() => {
        const map = new Map<string, EquipmentItemDto>();
        if (character?.equipment?.items) {
            for (const item of character.equipment.items) map.set(item.slot.toUpperCase(), item);
        }
        return map;
    }, [character]);
}

/** Boss & Loot Preview Panel main component */
export function BossLootPanel({ contentInstances, gameSlug, characterId }: BossLootPanelProps) {
    const variant = useMemo(() => slugToVariant(gameSlug), [gameSlug]);
    const [panelOpen, setPanelOpen] = useState(true);
    const instances = useContentInstances(contentInstances);
    const { data: character } = useCharacterDetail(characterId);
    const wowheadVariant = character?.gameVariant ?? variant;
    const equippedBySlot = useEquippedBySlot(character);

    if (!instances.length) return null;
    return (
        <div className="boss-loot-panel">
            <PanelHeader panelOpen={panelOpen} onToggle={() => setPanelOpen((v) => !v)} />
            {panelOpen && instances.map((inst) => (
                <InstanceBossList key={inst.id} instanceId={inst.id} instanceName={inst.name}
                    variant={variant} wowheadVariant={wowheadVariant} equippedBySlot={equippedBySlot}
                    characterClass={character?.class} hasCharacter={!!characterId} />
            ))}
        </div>
    );
}

/** Collapsible panel header */
function PanelHeader({ panelOpen, onToggle }: { panelOpen: boolean; onToggle: () => void }) {
    return (
        <div
            className={`boss-loot-panel__header ${panelOpen ? 'boss-loot-panel__header--expanded' : 'boss-loot-panel__header--collapsed'}`}
            onClick={onToggle}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle();
                }
            }}
        >
            <h2 className="boss-loot-panel__title">
                <span className="boss-loot-panel__title-icon">&#x2694;&#xFE0F;</span>
                Boss &amp; Loot
            </h2>
            <span className={`boss-loot-panel__chevron ${panelOpen ? 'boss-loot-panel__chevron--open' : ''}`}>
                &#x25B8;
            </span>
        </div>
    );
}

function useToggleSet() {
    const [ids, setIds] = useState<Set<number>>(new Set());
    const toggle = (id: number) => {
        setIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    return { ids, toggle };
}

/** Boss list for a single content instance */
function InstanceBossList({
    instanceId, instanceName, variant, wowheadVariant,
    equippedBySlot, characterClass, hasCharacter,
}: {
    instanceId: number; instanceName?: string; variant: string;
    wowheadVariant: string; equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null; hasCharacter: boolean;
}) {
    const { data: bosses, isLoading } = useBossesForInstance(instanceId, variant);
    const { ids: expandedBossIds, toggle: toggleBoss } = useToggleSet();

    if (isLoading) {
        return (
            <div className="boss-loot-instance">
                {instanceName && <h3 className="boss-loot-instance__name">{instanceName}</h3>}
                <div className="boss-loot-body__loading">Loading bosses&hellip;</div>
            </div>
        );
    }
    if (!bosses || bosses.length === 0) return null;

    return (
        <div className="boss-loot-instance">
            {instanceName && <h3 className="boss-loot-instance__name">{instanceName}</h3>}
            {bosses.map((boss) => (
                <BossRow key={boss.id} boss={boss} isExpanded={expandedBossIds.has(boss.id)}
                    onToggle={() => toggleBoss(boss.id)} variant={variant} wowheadVariant={wowheadVariant}
                    equippedBySlot={equippedBySlot} characterClass={characterClass} hasCharacter={hasCharacter} />
            ))}
        </div>
    );
}

/** A single boss row with collapsible loot table */
function BossRow({
    boss, isExpanded, onToggle, variant,
    wowheadVariant, equippedBySlot, characterClass, hasCharacter,
}: {
    boss: BossEncounterDto; isExpanded: boolean; onToggle: () => void;
    variant: string; wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    characterClass?: string | null; hasCharacter: boolean;
}) {
    const { data: loot, isLoading: lootLoading } = useLootForBoss(
        isExpanded ? boss.id : undefined, variant,
    );
    useWowheadTooltips([loot]);

    return (
        <div className="boss-row">
            <BossRowHeader boss={boss} isExpanded={isExpanded} onToggle={onToggle} wowheadVariant={wowheadVariant} />
            {isExpanded && (
                <BossLootBody
                    loot={loot} isLoading={lootLoading} wowheadVariant={wowheadVariant}
                    equippedBySlot={equippedBySlot} characterClass={characterClass}
                    hasCharacter={hasCharacter}
                />
            )}
        </div>
    );
}

function handleKeyToggle(e: React.KeyboardEvent, onToggle: () => void) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
}

/** Boss row header with name, order, and wowhead link */
function BossRowHeader({ boss, isExpanded, onToggle, wowheadVariant }: {
    boss: BossEncounterDto; isExpanded: boolean; onToggle: () => void; wowheadVariant: string;
}) {
    return (
        <div className="boss-row__header-wrapper">
            <div className="boss-row__header" onClick={onToggle} role="button" tabIndex={0}
                onKeyDown={(e) => handleKeyToggle(e, onToggle)}>
                <span className={`boss-row__chevron ${isExpanded ? 'boss-row__chevron--open' : ''}`}>&#x25B8;</span>
                <span className="boss-row__order">{boss.order}</span>
                <span className="boss-row__name">{boss.name}</span>
                {boss.sodModified && <span className="boss-row__sod-badge">SoD</span>}
            </div>
            <a className="boss-row__wowhead-link" href={getWowheadNpcSearchUrl(boss.name, wowheadVariant)}
                target="_blank" rel="noopener noreferrer" title="View on Wowhead">&#x2197;</a>
        </div>
    );
}
