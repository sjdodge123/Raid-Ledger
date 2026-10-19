/**
 * ROK-1836 — item detail: an anchored popover at ≥1024px, a `BottomSheet`
 * below it (§4.4 viewport rule). Carries the D11 wiki link-out; no wiki data
 * is copied — the name comes from the mod catalogue.
 */
import { useEffect, useId, useRef, type JSX, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ValheimItemStack } from '@raid-ledger/contract';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { useAnchoredPopup } from '../../../components/ui/use-anchored-popup';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { durabilityPct, valheimWikiUrl, type ResolvedItem } from './item-icon.helpers';

export interface ItemDetailData {
    resolved: ResolvedItem;
    item: ValheimItemStack;
    equipped: boolean;
}

function Row({ term, children }: { term: string; children: ReactNode }): JSX.Element {
    return <><dt className="text-muted">{term}</dt><dd className="tabular-nums text-foreground">{children}</dd></>;
}

function DurabilityRow({ item }: { item: ValheimItemStack }): JSX.Element | null {
    const pct = durabilityPct(item);
    if (pct === null || item.durability === null || item.maxDurability === null) return null;
    return (
        <Row term="Durability">
            {Math.round(item.durability)} / {Math.round(item.maxDurability)}
            <div className="mt-1"><GuildMeter pct={pct} tone={pct < 30 ? 'warning' : 'success'} label="Durability" /></div>
        </Row>
    );
}

export function ItemDetailBody({ resolved, item, equipped }: ItemDetailData): JSX.Element {
    return (
        <div className="flex flex-col gap-3 text-sm">
            <p className="text-xs text-muted">
                {resolved.category ?? (resolved.kind === 'unknown' ? 'Unknown item' : 'Item')} · <code>{item.prefab}</code>
            </p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                {item.quality > 1 || resolved.kind !== 'unknown' ? <Row term="Quality">{item.quality}</Row> : null}
                {item.stack > 1 ? <Row term="Stack">{item.stack}</Row> : null}
                <DurabilityRow item={item} />
                {equipped ? <Row term="Status">Equipped</Row> : null}
            </dl>
            {resolved.kind === 'unknown' ? (
                <p className="text-xs text-muted">This item isn&apos;t in the server&apos;s item catalogue, so it shows its game id.</p>
            ) : (
                <a href={valheimWikiUrl(resolved.label)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-success hover:underline">
                    Open on the Valheim wiki<ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
                </a>
            )}
        </div>
    );
}

interface PopoverProps extends ItemDetailData {
    onClose: () => void;
    anchorRef: RefObject<HTMLElement | null>;
    returnRef: RefObject<HTMLElement | null>;
    container: HTMLElement;
}

function ItemPopover({ onClose, anchorRef, returnRef, container, ...data }: PopoverProps): JSX.Element {
    const popupRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    const pos = useAnchoredPopup(anchorRef, popupRef, true, onClose);
    useEffect(() => {
        popupRef.current?.focus();
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') { onClose(); returnRef.current?.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose, returnRef]);
    return createPortal(
        <div ref={popupRef} role="dialog" aria-labelledby={titleId} tabIndex={-1} data-testid="valheim-item-popover"
            className="fixed z-50 w-72 rounded-lg border border-edge bg-panel p-3 shadow-lg focus:outline-none"
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
            <h3 id={titleId} className="mb-1 text-sm font-semibold text-foreground">{data.resolved.label}</h3>
            <ItemDetailBody {...data} />
        </div>,
        container,
    );
}

export function ItemDetail({ open, ...props }: PopoverProps & { open: boolean }): JSX.Element | null {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (isDesktop) return open ? <ItemPopover {...props} /> : null;
    const { resolved, item, equipped, onClose } = props;
    return (
        <BottomSheet isOpen={open} onClose={onClose} title={resolved.label}>
            <ItemDetailBody resolved={resolved} item={item} equipped={equipped} />
        </BottomSheet>
    );
}
