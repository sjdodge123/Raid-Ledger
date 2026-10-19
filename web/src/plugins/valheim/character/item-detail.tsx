/**
 * ROK-1836 — item detail: an anchored popover at ≥1024px, a `BottomSheet`
 * below it (§4.4 viewport rule). Carries the D11 wiki link-out; no wiki data
 * is copied — the name comes from the mod catalogue.
 */
import {
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    type CSSProperties,
    type JSX,
    type ReactNode,
    type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { ValheimItemStack } from '@raid-ledger/contract';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { useAnchoredPopup } from '../../../components/ui/use-anchored-popup';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { clampPopover } from './popover-clamp';
import {
    durabilityPct,
    valheimWikiUrl,
    type ResolvedItem,
} from './item-icon.helpers';

export interface ItemDetailData {
    resolved: ResolvedItem;
    item: ValheimItemStack;
    equipped: boolean;
}

function Row({
    term,
    children,
}: {
    term: string;
    children: ReactNode;
}): JSX.Element {
    return (
        <>
            <dt className="text-muted">{term}</dt>
            <dd className="tabular-nums text-foreground">{children}</dd>
        </>
    );
}

function DurabilityRow({
    item,
}: {
    item: ValheimItemStack;
}): JSX.Element | null {
    const pct = durabilityPct(item);
    if (pct === null || item.durability === null || item.maxDurability === null)
        return null;
    return (
        <Row term="Durability">
            {Math.round(item.durability)} / {Math.round(item.maxDurability)}
            <div className="mt-1">
                <GuildMeter
                    pct={pct}
                    tone={pct < 30 ? 'warning' : 'success'}
                    label="Durability"
                />
            </div>
        </Row>
    );
}

function ItemStats({ resolved, item, equipped }: ItemDetailData): JSX.Element {
    return (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
            {item.quality > 1 || resolved.kind !== 'unknown' ? (
                <Row term="Quality">{item.quality}</Row>
            ) : null}
            {item.stack > 1 ? <Row term="Stack">{item.stack}</Row> : null}
            <DurabilityRow item={item} />
            {equipped ? <Row term="Status">Equipped</Row> : null}
        </dl>
    );
}

function ItemLinkOut({ resolved }: { resolved: ResolvedItem }): JSX.Element {
    if (resolved.kind === 'unknown') {
        return (
            <p className="text-xs text-muted">
                This item isn&apos;t in the server&apos;s item catalogue, so it
                shows its game id.
            </p>
        );
    }
    return (
        <a
            href={valheimWikiUrl(resolved.label)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-secondary"
        >
            Open on the Valheim wiki
            <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
        </a>
    );
}

export function ItemDetailBody(data: ItemDetailData): JSX.Element {
    const { resolved, item } = data;
    const category =
        resolved.category ??
        (resolved.kind === 'unknown' ? 'Unknown item' : 'Item');
    return (
        <div className="flex flex-col gap-3 text-sm">
            <p className="text-xs text-muted">
                {category} · <code>{item.prefab}</code>
            </p>
            <ItemStats {...data} />
            <ItemLinkOut resolved={resolved} />
        </div>
    );
}

interface PopoverProps extends ItemDetailData {
    onClose: () => void;
    anchorRef: RefObject<HTMLElement | null>;
    returnRef: RefObject<HTMLElement | null>;
    container: HTMLElement;
}

/** Used until the popover has laid out (jsdom never lays out). */
const FALLBACK = { width: 288, height: 240 };

/**
 * `top`/`left` start at 0 (as the shared Combobox popup does) so the first
 * `useAnchoredPopup` measurement reads the true containing-block origin, not
 * the unpositioned static spot. The clamp then owns both coordinates.
 */
function popoverStyle(
    pos: { top: number; left: number } | null,
): CSSProperties {
    return { top: 0, left: 0, visibility: pos ? 'visible' : 'hidden' };
}

/**
 * Clamp the anchored position inside the viewport (flip above, shift left).
 * `pos` is in the popup's containing-block frame, so the anchor's viewport
 * rect gives the offset back. Written to the node before paint.
 */
function useClampedPopover(
    pos: { top: number; left: number } | null,
    anchorRef: RefObject<HTMLElement | null>,
    popupRef: RefObject<HTMLElement | null>,
): void {
    useLayoutEffect(() => {
        const el = popupRef.current;
        const a = anchorRef.current?.getBoundingClientRect();
        if (!el || !a || !pos) return;
        const at = clampPopover({
            anchor: { left: a.left, top: a.top, bottom: a.bottom },
            size: {
                width: el.offsetWidth || FALLBACK.width,
                height: el.offsetHeight || FALLBACK.height,
            },
            viewport: { width: window.innerWidth, height: window.innerHeight },
        });
        el.style.left = `${at.left - (a.left - pos.left)}px`;
        el.style.top = `${at.top - (a.bottom + 4 - pos.top)}px`;
    }, [pos, anchorRef, popupRef]);
}

/**
 * Focus the popover once it is positioned (a `visibility: hidden` node refuses
 * focus); Escape closes it and returns focus to the tile.
 */
function useFocusAndEscape(
    popupRef: RefObject<HTMLElement | null>,
    visible: boolean,
    onClose: () => void,
    returnRef: RefObject<HTMLElement | null>,
): void {
    useEffect(() => {
        if (visible) popupRef.current?.focus();
    }, [popupRef, visible]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                onClose();
                returnRef.current?.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [popupRef, onClose, returnRef]);
}

const POPOVER_TITLE = 'mb-1 text-sm font-semibold text-foreground';

function ItemPopover({
    onClose,
    anchorRef,
    returnRef,
    container,
    ...data
}: PopoverProps): JSX.Element {
    const popupRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    const pos = useAnchoredPopup(anchorRef, popupRef, true, onClose);
    useClampedPopover(pos, anchorRef, popupRef);
    useFocusAndEscape(popupRef, pos !== null, onClose, returnRef);
    return createPortal(
        <div
            ref={popupRef}
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            data-testid="valheim-item-popover"
            className="fixed z-50 w-72 rounded-lg border border-edge bg-panel p-3 shadow-lg focus:outline-none"
            style={popoverStyle(pos)}
        >
            <h3 id={titleId} className={POPOVER_TITLE}>
                {data.resolved.label}
            </h3>
            <ItemDetailBody {...data} />
        </div>,
        container,
    );
}

export function ItemDetail({
    open,
    ...props
}: PopoverProps & { open: boolean }): JSX.Element | null {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (!open) return null;
    if (isDesktop) return <ItemPopover {...props} />;
    // Unmounted while closed: a closed sheet's Close button and wiki link would
    // otherwise stay keyboard-focusable and in the accessibility tree.
    const { resolved, item, equipped, onClose } = props;
    return (
        <BottomSheet isOpen={open} onClose={onClose} title={resolved.label}>
            <ItemDetailBody
                resolved={resolved}
                item={item}
                equipped={equipped}
            />
        </BottomSheet>
    );
}
