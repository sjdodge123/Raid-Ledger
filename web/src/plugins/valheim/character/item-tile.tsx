/**
 * ROK-1836 — one game-item cell (new pattern, design-system §3.2 row in L4):
 * a ≥44px `<button>` with the icon face (D6/D7), quality pips, stack count,
 * durability meter and the equipped corner; it opens `ItemDetail`.
 */
import { useCallback, useRef, useState, type JSX, type Ref } from 'react';
import type { ValheimItemStack } from '@raid-ledger/contract';
import { usePortalTarget } from '../../../components/ui/use-anchored-popup';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import {
    durabilityPct,
    itemAriaLabel,
    resolveItem,
    type ResolvedItem,
} from './item-icon.helpers';
import { ItemIcon } from './item-icon';
import { ItemDetail } from './item-detail';
import type { ItemIconContext } from './use-item-icons';

const TILE =
    'relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border';

/** An empty grid / equipment cell — same geometry, not interactive. */
export function EmptyItemTile(): JSX.Element {
    return (
        <span
            aria-hidden="true"
            data-testid="valheim-empty-tile"
            className={`${TILE} border-dashed border-edge bg-transparent`}
        />
    );
}

const FACE_SKIN: Record<ResolvedItem['kind'], string> = {
    icon: 'border-edge bg-panel',
    initials: 'border-dashed border-edge bg-panel',
    unknown: 'border-edge bg-surface',
};

/** Five pips fit the 44px tile; above that one pip + "×q" (contract allows quality 10). */
const MAX_PIPS = 5;

function QualityPips({ quality }: { quality: number }): JSX.Element | null {
    if (quality <= 1) return null;
    const pips = quality > MAX_PIPS ? 1 : quality;
    return (
        <span
            aria-hidden="true"
            data-testid="valheim-quality-pips"
            className="absolute left-[3px] top-[3px] flex gap-0.5"
        >
            {Array.from({ length: pips }, (_, i) => (
                <i key={i} className="h-1 w-1 rounded-full bg-warning" />
            ))}
            {quality > MAX_PIPS ? (
                <b className="-mt-px text-[9px] font-bold leading-none text-warning">
                    ×{quality}
                </b>
            ) : null}
        </span>
    );
}

function DurabilityBar({
    item,
}: {
    item: ValheimItemStack;
}): JSX.Element | null {
    const pct = durabilityPct(item);
    if (pct === null) return null;
    return (
        <span
            aria-hidden="true"
            className="absolute inset-x-[3px] bottom-[3px]"
        >
            <GuildMeter
                pct={pct}
                tone={pct < 30 ? 'warning' : 'success'}
                label="Durability"
            />
        </span>
    );
}

function TileBadges({
    item,
    equipped,
}: {
    item: ValheimItemStack;
    equipped: boolean;
}): JSX.Element {
    return (
        <>
            <QualityPips quality={item.quality} />
            {item.stack > 1 ? (
                <span
                    aria-hidden="true"
                    className="absolute bottom-0.5 right-[3px] text-[11px] font-bold text-foreground [text-shadow:0_0_2px_var(--color-backdrop)]"
                >
                    {item.stack}
                </span>
            ) : null}
            <DurabilityBar item={item} />
            {equipped ? (
                <span
                    aria-hidden="true"
                    data-testid="valheim-equipped-marker"
                    className="absolute right-0 top-0 h-2.5 w-2.5 bg-success [clip-path:polygon(0_0,100%_0,100%_100%)]"
                />
            ) : null}
        </>
    );
}

interface TileButtonProps {
    ref: Ref<HTMLButtonElement>;
    resolved: ResolvedItem;
    item: ValheimItemStack;
    ctx: ItemIconContext;
    equipped: boolean;
    open: boolean;
    onToggle: () => void;
    focusProps?: GridFocusProps | undefined;
}

/** Roving-tabindex props from a grid (`useRovingGrid`); absent outside a grid. */
export interface GridFocusProps {
    tabIndex: number;
    'data-rc': string;
}

function TileButton({
    ref,
    resolved,
    item,
    ctx,
    equipped,
    open,
    onToggle,
    focusProps,
}: TileButtonProps): JSX.Element {
    return (
        <button
            {...focusProps}
            ref={ref}
            type="button"
            title={resolved.label}
            data-kind={resolved.kind}
            aria-label={itemAriaLabel(resolved.label, item, equipped)}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={onToggle}
            className={`${TILE} ${FACE_SKIN[resolved.kind]} cursor-pointer p-0 transition-colors hover:border-edge-strong hover:bg-overlay`}
        >
            <ItemIcon resolved={resolved} prefab={item.prefab} ctx={ctx} />
            <TileBadges item={item} equipped={equipped} />
        </button>
    );
}

function useDisclosure(): {
    open: boolean;
    toggle: () => void;
    close: () => void;
} {
    const [open, setOpen] = useState(false);
    const toggle = useCallback(() => setOpen((v) => !v), []);
    const close = useCallback(() => setOpen(false), []);
    return { open, toggle, close };
}

interface ItemTileProps {
    item: ValheimItemStack;
    ctx: ItemIconContext;
    equipped?: boolean;
    focusProps?: GridFocusProps | undefined;
}

export function ItemTile({
    item,
    ctx,
    equipped = false,
    focusProps,
}: ItemTileProps): JSX.Element {
    const { open, toggle, close } = useDisclosure();
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const { anchorRef, setAnchorRef, container } = usePortalTarget();
    const resolved = resolveItem(item.prefab, ctx.items, ctx.atlas);
    const data = { resolved, item, equipped };
    return (
        <div ref={setAnchorRef} className="inline-flex">
            <TileButton
                ref={buttonRef}
                open={open}
                onToggle={toggle}
                focusProps={focusProps}
                ctx={ctx}
                {...data}
            />
            <ItemDetail
                {...{ open, anchorRef, container, ...data }}
                onClose={close}
                returnRef={buttonRef}
            />
        </div>
    );
}
