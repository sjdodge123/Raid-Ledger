/**
 * ROK-1860 D8 — "how do I make this?": the viewer picks one of an item's
 * sources (catalogue `sourceOptions`) or goes back to the resolver's pick.
 * Modal at ≥1024px, BottomSheet below (design-system §4.4); inside, one
 * `RadioGroup` — station + level, the q1 cost with item icons, "Best guess"
 * on the default (D9) and the discovery chip on an unlearned recipe (D11).
 */
import type { JSX } from 'react';
import type { ValheimRecipeCatalogEntry, ValheimRecipeSourceOption, ValheimRecipeSourceRef } from '@raid-ledger/contract';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { Modal } from '../../../components/ui/modal';
import { RadioGroup, type RadioOption } from '../../../components/ui/radio-group';
import { StatusChip } from '../../../components/ui/status-chip';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { ItemIcon } from '../character/item-icon';
import { resolveItem } from '../character/item-icon.helpers';
import { BY_HAND_LABEL } from './crafting.helpers';
import { DiscoveryChip } from './discovery-chip';
import { formatAmount } from './planner.helpers';
import type { PlannerNames } from './use-planner-names';

export const SOURCE_DEFAULT_VALUE = 'default';
export const SOURCE_DEFAULT_LABEL = 'Use the default';
export const SOURCE_BEST_GUESS_COPY = 'Best guess';

export interface SourcePickerProps {
    /** The item whose sources are offered; null renders nothing. */
    entry: ValheimRecipeCatalogEntry | null;
    /** The viewer's stored pick; undefined = no override. */
    current: ValheimRecipeSourceRef | undefined;
    /** A source, or null for "Use the default". */
    onPick: (ref: ValheimRecipeSourceRef | null) => void;
    onClose: () => void;
    open: boolean;
    names: PlannerNames;
}

/** A radio value per source ref (stable across renders). */
function sourceRefKey(ref: ValheimRecipeSourceRef): string {
    return ref.type === 'recipe' ? `r:${ref.recipeId}` : `p:${ref.processor}:${ref.index}`;
}

function stationLine(o: ValheimRecipeSourceOption, names: PlannerNames): string {
    if (o.station === null) return BY_HAND_LABEL;
    const name = names.stationName(o.station);
    return o.ref.type === 'recipe' && o.stationLevel > 0 ? `${name} · lvl ${o.stationLevel}` : name;
}

function CostLine({ option, names }: { option: ValheimRecipeSourceOption; names: PlannerNames }): JSX.Element {
    return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {option.resources.map(({ prefab, amount }) => {
                const ctx = names.ctxFor(prefab, 'item');
                const label = names.nameOf(prefab, 'item');
                return (
                    <span key={prefab} className="inline-flex items-center gap-1 tabular-nums" title={label}>
                        <ItemIcon resolved={{ ...resolveItem(prefab, ctx.items, ctx.atlas), label }} prefab={prefab} ctx={ctx} />
                        <span>{label} × {formatAmount(amount)}</span>
                    </span>
                );
            })}
            {option.outputAmount > 1 && <span>Makes {formatAmount(option.outputAmount)}</span>}
        </span>
    );
}

function OptionLabel({ option, names }: { option: ValheimRecipeSourceOption; names: PlannerNames }): JSX.Element {
    return (
        <span className="flex flex-wrap items-center gap-2">
            <StatusChip tone="neutral" className="whitespace-normal!">{stationLine(option, names)}</StatusChip>
            {option.default && <StatusChip tone="success">{SOURCE_BEST_GUESS_COPY}</StatusChip>}
            {option.discovered === false && <DiscoveryChip />}
        </span>
    );
}

function radioOptions(options: readonly ValheimRecipeSourceOption[], names: PlannerNames): RadioOption<string>[] {
    const list: RadioOption<string>[] = options.map((o) => ({
        value: sourceRefKey(o.ref),
        label: <OptionLabel option={o} names={names} />,
        description: <CostLine option={o} names={names} />,
    }));
    list.push({ value: SOURCE_DEFAULT_VALUE, label: SOURCE_DEFAULT_LABEL, description: 'Let the planner choose (the best guess).' });
    return list;
}

function PickerBody({ entry, current, onPick, names }: Omit<SourcePickerProps, 'entry' | 'open' | 'onClose'> & { entry: ValheimRecipeCatalogEntry }): JSX.Element {
    const options = entry.sourceOptions ?? [];
    const byKey = new Map(options.map((o) => [sourceRefKey(o.ref), o.ref]));
    const onChange = (value: string): void => onPick(byKey.get(value) ?? null);
    return (
        <div data-testid="valheim-source-picker">
            <RadioGroup label={`How to make ${entry.name}`} hideLabel options={radioOptions(options, names)}
                value={current === undefined ? SOURCE_DEFAULT_VALUE : sourceRefKey(current)} onChange={onChange} />
        </div>
    );
}

export function SourcePicker(props: SourcePickerProps): JSX.Element | null {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const { entry, open, onClose } = props;
    // Unmounted when closed: a closed BottomSheet only slides off-screen and would stay focusable.
    if (entry === null || !open) return null;
    const title = `How to make ${entry.name}`;
    const body = <PickerBody entry={entry} current={props.current} onPick={props.onPick} names={props.names} />;
    return isDesktop ? (
        <Modal isOpen onClose={onClose} title={title} maxWidth="max-w-md">{body}</Modal>
    ) : (
        <BottomSheet isOpen onClose={onClose} title={title}>{body}</BottomSheet>
    );
}
