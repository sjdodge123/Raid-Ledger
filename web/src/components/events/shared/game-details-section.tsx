import { useMemo, useEffect, useRef, useCallback } from 'react';
import type { IgdbGameDto } from '@raid-ledger/contract';
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
    /** HTML id for the title input (for scroll-into-view on validation) */
    titleInputId?: string;
    /** HTML id for the event type select */
    eventTypeSelectId?: string;
    /** Whether to show the event type dropdown (hidden in edit mode for create form) */
    showEventType?: boolean;
    onGameChange: (game: IgdbGameDto | null) => void;
    onEventTypeIdChange: (id: number | null) => void;
    onTitleChange: (title: string, isAutoSuggested: boolean) => void;
    onDescriptionChange: (description: string, isAutoSuggested: boolean) => void;
    onSelectedInstancesChange: (instances: Record<string, unknown>[]) => void;
    /** Called when event type changes with the computed roster/duration defaults */
    onEventTypeDefaults?: (defaults: Partial<SlotState>) => void;
    /** Optional interest stats display */
    interestCount?: number;
    interestLoading?: boolean;
    /** Content inserted between the game/content area and the title/description fields.
     *  Use this to add section dividers or new section headers between the two areas. */
    slotBetween?: React.ReactNode;
}

export function GameDetailsSection({
    game,
    eventTypeId,
    title,
    description,
    selectedInstances,
    titleIsAutoSuggested,
    descriptionIsAutoSuggested,
    titleError,
    titleInputId = 'title',
    eventTypeSelectId = 'eventType',
    showEventType = true,
    onGameChange,
    onEventTypeIdChange,
    onTitleChange,
    onDescriptionChange,
    onSelectedInstancesChange,
    onEventTypeDefaults,
    interestCount,
    interestLoading,
    slotBetween,
}: GameDetailsSectionProps) {
    const { games: registryGames } = useGameRegistry();

    const gameName = game?.name;
    const gameSlug = game?.slug;
    const registryGame = useMemo(() => {
        if (!gameName && !gameSlug) return undefined;
        return registryGames.find(
            (g) => (gameName && g.name.toLowerCase() === gameName.toLowerCase()) || g.slug === gameSlug,
        );
    }, [gameName, gameSlug, registryGames]);
    const registryGameId = registryGame?.id;
    const registrySlug = registryGame?.slug;

    const { data: eventTypesData } = useEventTypes(registryGameId);
    const eventTypes = eventTypesData?.data ?? [];

    const wowVariant = registrySlug ? getWowVariant(registrySlug) : null;
    const selectedEventType = eventTypes.find((t) => t.id === eventTypeId);
    const contentType = selectedEventType?.slug ? getContentType(selectedEventType.slug) : null;

    // Track previous auto-suggestions to detect manual edits
    const prevSuggestionRef = useRef('');
    const prevDescSuggestionRef = useRef('');

    // Title auto-suggestion
    const computeSuggestion = useCallback((): string => {
        const etName = selectedEventType?.name;
        const gName = game?.name;
        const instances = selectedInstances;

        if (instances.length > 0 && etName) {
            const names = instances.map((i) => (i.shortName as string) || (i.name as string) || '');
            const playerCap = selectedEventType?.defaultPlayerCap;
            const suffix = playerCap ? ` ${playerCap} man` : '';
            return `${names.join(' + ')}${suffix}`;
        }
        if (etName && gName) {
            return `${etName} \u2014 ${gName}`;
        }
        if (gName) {
            return `${gName} Event`;
        }
        return '';
    }, [selectedEventType?.name, selectedEventType?.defaultPlayerCap, game?.name, selectedInstances]);

    // Description auto-suggestion
    const computeDescriptionSuggestion = useCallback((): string => {
        const instances = selectedInstances;
        if (instances.length === 0) return '';
        const levels = instances
            .map((i) => ({ min: i.minimumLevel as number | undefined, max: (i.maximumLevel ?? i.minimumLevel) as number | undefined }))
            .filter((l): l is { min: number; max: number } => l.min != null);
        if (levels.length === 0) return '';
        const overlapMin = Math.max(...levels.map((l) => l.min));
        const overlapMax = Math.min(...levels.map((l) => l.max));
        if (overlapMin > overlapMax) {
            const fullMin = Math.min(...levels.map((l) => l.min));
            const fullMax = Math.max(...levels.map((l) => l.max));
            return `Level ${fullMin}-${fullMax} suggested`;
        }
        if (overlapMin === overlapMax) return `Level ${overlapMin} suggested`;
        return `Level ${overlapMin}-${overlapMax} suggested`;
    }, [selectedInstances]);

    // Auto-fill title and description when suggestions change
    useEffect(() => {
        const newSuggestion = computeSuggestion();
        const newDescSuggestion = computeDescriptionSuggestion();

        // Title auto-fill
        if (newSuggestion && (titleIsAutoSuggested || title === '' || title === prevSuggestionRef.current)) {
            onTitleChange(newSuggestion, true);
        }
        prevSuggestionRef.current = newSuggestion;

        // Description auto-fill
        if (newDescSuggestion && (descriptionIsAutoSuggested || description === '' || description === prevDescSuggestionRef.current)) {
            onDescriptionChange(newDescSuggestion, true);
        }
        prevDescSuggestionRef.current = newDescSuggestion;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [computeSuggestion, computeDescriptionSuggestion]);

    function handleEventTypeChange(raw: string) {
        if (raw === 'custom') {
            onEventTypeIdChange(null);
            onSelectedInstancesChange([]);
            if (onEventTypeDefaults) {
                onEventTypeDefaults(applyEventTypeDefaults(null));
            }
            return;
        }
        const id = parseInt(raw, 10);
        const et = eventTypes.find((t) => t.id === id);
        if (!et) return;
        onEventTypeIdChange(id);
        onSelectedInstancesChange([]);
        if (onEventTypeDefaults) {
            onEventTypeDefaults(applyEventTypeDefaults(et));
        }
    }

    return (
        <>
            {/* Game Search */}
            <GameSearchInput
                value={game}
                onChange={(g) => {
                    onGameChange(g);
                    onEventTypeIdChange(null);
                    onSelectedInstancesChange([]);
                }}
            />

            {/* Interest Stat */}
            {game && !interestLoading && interestCount != null && interestCount > 0 && (
                <p className="text-xs text-muted -mt-2">
                    <span className="text-emerald-400 font-medium">{interestCount}</span> player{interestCount !== 1 ? 's' : ''} interested
                </p>
            )}

            {/* Event Type Dropdown */}
            {showEventType && eventTypes.length > 0 && (
                <div>
                    <label htmlFor={eventTypeSelectId} className="block text-sm font-medium text-secondary mb-2">
                        Event Type
                    </label>
                    <select
                        id={eventTypeSelectId}
                        value={eventTypeId != null ? String(eventTypeId) : 'custom'}
                        onChange={(e) => handleEventTypeChange(e.target.value)}
                        className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                    >
                        <option value="custom">Custom</option>
                        {eventTypes.map((et) => (
                            <option key={et.id} value={et.id}>
                                {et.name}
                                {et.defaultPlayerCap ? ` (${et.defaultPlayerCap}-player)` : ''}
                            </option>
                        ))}
                    </select>
                    <p className="mt-1 text-xs text-dim">
                        Auto-fills duration and roster slots based on content type
                    </p>
                </div>
            )}

            {/* Content Selection — plugin-provided */}
            {wowVariant && contentType && (
                <PluginSlot
                    name="event-create:content-browser"
                    context={{
                        wowVariant,
                        contentType,
                        selectedInstances,
                        onInstancesChange: (instances: Record<string, unknown>[]) => onSelectedInstancesChange(instances),
                    }}
                />
            )}

            {slotBetween}

            {/* Title */}
            <div>
                <label htmlFor={titleInputId} className="block text-sm font-medium text-secondary mb-2">
                    Event Title <span className="text-red-400">*</span>
                </label>
                <input
                    id={titleInputId}
                    type="text"
                    value={title}
                    onChange={(e) => onTitleChange(e.target.value, false)}
                    placeholder={computeSuggestion() || 'Weekly Raid Night'}
                    maxLength={200}
                    className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${titleError ? 'border-red-500' : 'border-edge'}`}
                />
                {titleIsAutoSuggested && (
                    <p className="mt-1 text-xs text-dim">Auto-suggested from your selections</p>
                )}
                {titleError && (
                    <p className="mt-1 text-sm text-red-400">{titleError}</p>
                )}
            </div>

            {/* Description */}
            <div>
                <label htmlFor={`${titleInputId}-description`} className="block text-sm font-medium text-secondary mb-2">
                    Description
                </label>
                <textarea
                    id={`${titleInputId}-description`}
                    value={description}
                    onChange={(e) => onDescriptionChange(e.target.value, false)}
                    placeholder={computeDescriptionSuggestion() || 'Add details about this event...'}
                    maxLength={2000}
                    rows={3}
                    className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors resize-none"
                />
                {descriptionIsAutoSuggested && (
                    <p className="mt-1 text-xs text-dim">Auto-suggested from your selections</p>
                )}
            </div>
        </>
    );
}
