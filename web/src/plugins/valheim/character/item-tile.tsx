/**
 * ROK-1836 — one game-item cell (new pattern, design-system §3.2 row in L4):
 * a ≥44px `<button>` with the icon face (D6/D7), quality pips, stack count,
 * durability meter and the equipped corner; it opens `ItemDetail`.
 */
import { useCallback, useRef, useState, type JSX } from 'react';
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

function TileBadges({
    item,
    equipped,
}: {
    item: ValheimItemStack;
    equipped: boolean;
}): JSX.Element {
    const pct = durabilityPct(item);
    return (
        <>
            {item.quality > 1 ? (
                <span
                    aria-hidden="true"
                    data-testid="valheim-quality-pips"
                    className="absolute left-[3px] top-[3px] flex gap-0.5"
                >
                    {Array.from({ length: item.quality }, (_, i) => (
                        <i
                            key={i}
                            className="h-1 w-1 rounded-full bg-warning"
                        />
                    ))}
                </span>
            ) : null}
            {item.stack > 1 ? (
                <span
                    aria-hidden="true"
                    className="absolute bottom-0.5 right-[3px] text-[11px] font-bold text-foreground [text-shadow:0_0_2px_var(--color-backdrop)]"
                >
                    {item.stack}
                </span>
            ) : null}
            {pct !== null ? (
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
            ) : null}
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

export function ItemTile({
    item,
    ctx,
    equipped = false,
}: {
    item: ValheimItemStack;
    ctx: ItemIconContext;
    equipped?: boolean;
}): JSX.Element {
    const resolved = resolveItem(item.prefab, ctx.items, ctx.atlas);
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), [setOpen]);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const { anchorRef, setAnchorRef, container } = usePortalTarget();
    return (
        <div ref={setAnchorRef} className="inline-flex">
            <button
                ref={buttonRef}
                type="button"
                title={resolved.label}
                data-kind={resolved.kind}
                aria-label={itemAriaLabel(resolved.label, item, equipped)}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={`${TILE} ${FACE_SKIN[resolved.kind]} cursor-pointer p-0 transition-colors hover:border-edge-strong hover:bg-overlay`}
            >
                <ItemIcon resolved={resolved} prefab={item.prefab} ctx={ctx} />
                <TileBadges item={item} equipped={equipped} />
            </button>
            <ItemDetail
                open={open}
                onClose={close}
                anchorRef={anchorRef}
                returnRef={buttonRef}
                container={container}
                resolved={resolved}
                item={item}
                equipped={equipped}
            />
        </div>
    );
}
