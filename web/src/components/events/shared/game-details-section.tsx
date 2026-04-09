import { useMemo, useEffect, useRef, useCallback } from 'react';
import type { IgdbGameDto, EventTypeDto } from '@raid-ledger/contract';
import { GameSearchInput } from '../game-search-input';
import { useGameRegistry, useEventTypes } from '../../../hooks/use-game-registry';
import { PluginSlot } from '../../../plugins';
import { getWowVariant, getContentType } from '../../../plugins/wow/utils';
import { applyEventTypeDefaults, type SlotState } from './event-form-constants';

export interface GameDetailsSectionProps {
    game: IgdbGameDto | null;
    eventTypeId: number | null;
    title: string;
    description: string;
    selectedInstances: Record<string, unknown>[];
    titleIsAutoSuggested: boolean;
    descriptionIsAutoSuggested: boolean;
    titleError?: string;
    titleInputId?: string;
    eventTypeSelectId?: string;
    showEventType?: boolean;
    onGameChange: (game: IgdbGameDto | null) => void;
    onEventTypeIdChange: (id: number | null) => void;
    onTitleChange: (title: string, isAutoSuggested: boolean) => void;
    onDescriptionChange: (description: string, isAutoSuggested: boolean) => void;
    onSelectedInstancesChange: (instances: Record<string, unknown>[]) => void;
    onEventTypeDefaults?: (defaults: Partial<SlotState>) => void;
    interestCount?: number;
    interestLoading?: boolean;
    slotBetween?: React.ReactNode;
}

function useRegistryLookup(game: IgdbGameDto | null) {
    const { games: registryGames } = useGameRegistry();
    const gameName = game?.name;
    const gameSlug = game?.slug;
    return useMemo(() => {
        if (!gameName && !gameSlug) return undefined;
        return registryGames.find(
            (g) => (gameName && g.name.toLowerCase() === gameName.toLowerCase()) || g.slug === gameSlug,
        );
    }, [gameName, gameSlug, registryGames]);
}

function useTitleSuggestion(selectedEventType: { name?: string; defaultPlayerCap?: number | null } | undefined, game: IgdbGameDto | null, selectedInstances: Record<string, unknown>[]) {
    const etName = selectedEventType?.name;
    const etCap = selectedEventType?.defaultPlayerCap;
    const gName = game?.name;
    return useCallback((): string => {
        if (selectedInstances.length > 0 && etName) {
            const names = selectedInstances.map((i) => (i.shortName as string) || (i.name as string) || '');
            const suffix = etCap ? ` ${etCap} man` : '';
            return `${names.join(' + ')}${suffix}`;
        }
        if (etName && gName) return `${etName} \u2014 ${gName}`;
        if (gName) return `${gName} Event`;
        return '';
    }, [etName, etCap, gName, selectedInstances]);
}

function useDescriptionSuggestion(selectedInstances: Record<string, unknown>[]) {
    return useCallback((): string => {
        if (selectedInstances.length === 0) return '';
        const levels = selectedInstances
            .map((i) => ({ min: i.minimumLevel as number | undefined, max: (i.maximumLevel ?? i.minimumLevel) as number | undefined }))
            .filter((l): l is { min: number; max: number } => l.min != null);
        if (levels.length === 0) return '';
        const overlapMin = Math.max(...levels.map((l) => l.min));
        const overlapMax = Math.min(...levels.map((l) => l.max));
        if (overlapMin > overlapMax) {
            return `Level ${Math.min(...levels.map((l) => l.min))}-${Math.max(...levels.map((l) => l.max))} suggested`;
        }
        if (overlapMin === overlapMax) return `Level ${overlapMin} suggested`;
        return `Level ${overlapMin}-${overlapMax} suggested`;
    }, [selectedInstances]);
}

function useAutoFill(props: {
    computeSuggestion: () => string; computeDescSuggestion: () => string;
    title: string; description: string; titleIsAutoSuggested: boolean; descriptionIsAutoSuggested: boolean;
    onTitleChange: (v: string, auto: boolean) => void; onDescriptionChange: (v: string, auto: boolean) => void;
}) {
    const prevSuggestionRef = useRef('');
    const prevDescSuggestionRef = useRef('');

    useEffect(() => {
        const newSuggestion = props.computeSuggestion();
        const newDescSuggestion = props.computeDescSuggestion();

        if (newSuggestion && (props.titleIsAutoSuggested || props.title === '' || props.title === prevSuggestionRef.current)) {
            props.onTitleChange(newSuggestion, true);
        }
        prevSuggestionRef.current = newSuggestion;

        if (newDescSuggestion && (props.descriptionIsAutoSuggested || props.description === '' || props.description === prevDescSuggestionRef.current)) {
            props.onDescriptionChange(newDescSuggestion, true);
        }
        prevDescSuggestionRef.current = newDescSuggestion;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.computeSuggestion, props.computeDescSuggestion]);
}

function InterestStat({ game, interestCount, interestLoading }: { game: IgdbGameDto | null; interestCount?: number; interestLoading?: boolean }) {
    if (!game || interestLoading || interestCount == null || interestCount <= 0) return null;
    return (
        <p className="text-xs text-muted -mt-2">
            <span className="text-emerald-400 font-medium">{interestCount}</span> player{interestCount !== 1 ? 's' : ''} interested
        </p>
    );
}

function EventTypeDropdown({ eventTypeSelectId, eventTypeId, eventTypes, onEventTypeChange }: {
    eventTypeSelectId: string; eventTypeId: number | null;
    eventTypes: Array<{ id: number; name: string; defaultPlayerCap?: number | null }>;
    onEventTypeChange: (raw: string) => void;
}) {
    return (
        <div>
            <label htmlFor={eventTypeSelectId} className="block text-sm font-medium text-secondary mb-2">Event Type</label>
            <select id={eventTypeSelectId} value={eventTypeId != null ? String(eventTypeId) : 'custom'}
                onChange={(e) => onEventTypeChange(e.target.value)}
                className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors">
                <option value="custom">Custom</option>
                {eventTypes.map((et) => (
                    <option key={et.id} value={et.id}>{et.name}{et.defaultPlayerCap ? ` (${et.defaultPlayerCap}-player)` : ''}</option>
                ))}
            </select>
            <p className="mt-1 text-xs text-dim">Auto-fills duration and roster slots based on content type</p>
        </div>
    );
}

function TitleField({ titleInputId, title, titleError, titleIsAutoSuggested, placeholder, onTitleChange }: {
    titleInputId: string; title: string; titleError?: string; titleIsAutoSuggested: boolean;
    placeholder: string; onTitleChange: (v: string, auto: boolean) => void;
}) {
    return (
        <div>
            <label htmlFor={titleInputId} className="block text-sm font-medium text-secondary mb-2">Event Title <span className="text-red-400">*</span></label>
            <input id={titleInputId} type="text" value={title} onChange={(e) => onTitleChange(e.target.value, false)}
                placeholder={placeholder} maxLength={200}
                className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${titleError ? 'border-red-500' : 'border-edge'}`} />
            {titleIsAutoSuggested && <p className="mt-1 text-xs text-dim">Auto-suggested from your selections</p>}
            {titleError && <p className="mt-1 text-sm text-red-400">{titleError}</p>}
        </div>
    );
}

function DescriptionField({ titleInputId, description, descriptionIsAutoSuggested, placeholder, onDescriptionChange }: {
    titleInputId: string; description: string; descriptionIsAutoSuggested: boolean;
    placeholder: string; onDescriptionChange: (v: string, auto: boolean) => void;
}) {
    return (
        <div>
            <label htmlFor={`${titleInputId}-description`} className="block text-sm font-medium text-secondary mb-2">Description</label>
            <textarea id={`${titleInputId}-description`} value={description} onChange={(e) => onDescriptionChange(e.target.value, false)}
                placeholder={placeholder} maxLength={2000} rows={3}
                className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors resize-none" />
            {descriptionIsAutoSuggested && <p className="mt-1 text-xs text-dim">Auto-suggested from your selections</p>}
        </div>
    );
}

function useGameDetailsData(props: GameDetailsSectionProps) {
    const { game, eventTypeId, selectedInstances, onTitleChange, onDescriptionChange } = props;
    const registryGame = useRegistryLookup(game);
    const { data: eventTypesData } = useEventTypes(registryGame?.id);
    const eventTypes = eventTypesData?.data ?? [];
    const wowVariant = registryGame?.slug ? getWowVariant(registryGame.slug) : null;
    const selectedEventType = eventTypes.find((t) => t.id === eventTypeId);
    const instanceContentType = selectedInstances.length > 0
        ? (selectedInstances[0]?.category as 'dungeon' | 'raid' | undefined) ?? null
        : null;
    const contentType = selectedEventType?.slug
        ? getContentType(selectedEventType.slug)
        : instanceContentType;
    const computeSuggestion = useTitleSuggestion(selectedEventType, game, selectedInstances);
    const computeDescSuggestion = useDescriptionSuggestion(selectedInstances);
    useAutoFill({ computeSuggestion, computeDescSuggestion, title: props.title, description: props.description, titleIsAutoSuggested: props.titleIsAutoSuggested, descriptionIsAutoSuggested: props.descriptionIsAutoSuggested, onTitleChange, onDescriptionChange });
    return { eventTypes, wowVariant, contentType, computeSuggestion, computeDescSuggestion };
}

function handleEventTypeChange(
    raw: string, eventTypes: EventTypeDto[],
    onEventTypeIdChange: (id: number | null) => void, onSelectedInstancesChange: (i: Record<string, unknown>[]) => void,
    onEventTypeDefaults?: (defaults: Partial<SlotState>) => void,
) {
    if (raw === 'custom') {
        onEventTypeIdChange(null); onSelectedInstancesChange([]);
        if (onEventTypeDefaults) onEventTypeDefaults(applyEventTypeDefaults(null));
        return;
    }
    const id = parseInt(raw, 10);
    const et = eventTypes.find((t) => t.id === id);
    if (!et) return;
    onEventTypeIdChange(id); onSelectedInstancesChange([]);
    if (onEventTypeDefaults) onEventTypeDefaults(applyEventTypeDefaults(et));
}

export function GameDetailsSection(props: GameDetailsSectionProps) {
    const {
        game, eventTypeId, titleInputId = 'title', eventTypeSelectId = 'eventType', showEventType = true,
        onGameChange, onEventTypeIdChange, onSelectedInstancesChange, onEventTypeDefaults,
        interestCount, interestLoading, slotBetween,
    } = props;
    const d = useGameDetailsData(props);

    useEffect(() => {
        if (eventTypeId !== null || props.selectedInstances.length === 0 || d.eventTypes.length === 0) return;
        const category = props.selectedInstances[0]?.category as string | undefined;
        if (!category) return;
        const match = d.eventTypes.find(et => getContentType(et.slug) === category);
        if (match) onEventTypeIdChange(match.id);
    }, [d.eventTypes, eventTypeId, props.selectedInstances, onEventTypeIdChange]);

    return (
        <>
            <GameSearchInput value={game} onChange={(g) => { onGameChange(g); onEventTypeIdChange(null); onSelectedInstancesChange([]); }} />
            <InterestStat game={game} interestCount={interestCount} interestLoading={interestLoading} />
            {showEventType && d.eventTypes.length > 0 && (
                <EventTypeDropdown eventTypeSelectId={eventTypeSelectId} eventTypeId={eventTypeId} eventTypes={d.eventTypes}
                    onEventTypeChange={(raw) => handleEventTypeChange(raw, d.eventTypes, onEventTypeIdChange, onSelectedInstancesChange, onEventTypeDefaults)} />
            )}
            {d.wowVariant && d.contentType && (
                <PluginSlot name="event-create:content-browser"
                    context={{ wowVariant: d.wowVariant, contentType: d.contentType, selectedInstances: props.selectedInstances, onInstancesChange: (instances: Record<string, unknown>[]) => onSelectedInstancesChange(instances) }} />
            )}
            {slotBetween}
            <TitleField titleInputId={titleInputId} title={props.title} titleError={props.titleError}
                titleIsAutoSuggested={props.titleIsAutoSuggested} placeholder={d.computeSuggestion() || 'Weekly Raid Night'} onTitleChange={props.onTitleChange} />
            <DescriptionField titleInputId={titleInputId} description={props.description}
                descriptionIsAutoSuggested={props.descriptionIsAutoSuggested} placeholder={d.computeDescSuggestion() || 'Add details about this event...'} onDescriptionChange={props.onDescriptionChange} />
        </>
    );
}
