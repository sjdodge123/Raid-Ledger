import type { JSX } from 'react';
/**
 * Equipment grid and slot components for the character detail page.
 * Renders WoW character equipment in a paperdoll-style layout.
 */
import { useState } from 'react';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { isWowheadLoaded } from '../hooks/use-wowhead-tooltips';
import { ItemFallbackTooltip } from '../components/item-fallback-tooltip';
import { getWowheadItemUrl, getWowheadItemData } from '../lib/wowhead-urls';
import { itemWowheadVariant } from '../lib/item-wowhead-variant';
import { portraitKey, type ForeverPortrait } from '../lib/forever-portrait';
import { ForeverPortraitTile } from '../components/forever-portrait';
import type { CharacterEquipmentDto, EquipmentItemDto } from '@raid-ledger/contract';
import {
    QUALITY_COLORS, QUALITY_BORDERS, SLOT_LABELS,
    LEFT_SLOTS, RIGHT_SLOTS, BOTTOM_SLOTS,
} from './equipment-constants';

function EmptySlot({ slotName }: { slotName: string }) {
    return (
        <div className="flex items-center gap-3 p-2 rounded bg-overlay/30 border border-edge/50 min-h-[52px]">
            <div className="w-8 h-8 rounded bg-faint/50 flex items-center justify-center text-xs text-muted/50">--</div>
            <div className="min-w-0">
                <div className="text-xs text-muted/50">{SLOT_LABELS[slotName] ?? slotName}</div>
                <div className="text-xs text-muted/30">Empty</div>
            </div>
        </div>
    );
}

function SlotIcon({ item, iconBorderClass }: { item: EquipmentItemDto; iconBorderClass: string }) {
    return (
        <>
            {item.iconUrl ? (
                <img src={item.iconUrl} alt={item.name} width={32} height={32} loading="lazy" decoding="async"
                    className={`w-8 h-8 rounded border ${iconBorderClass} flex-shrink-0`}
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />
            ) : null}
            <div className={`w-8 h-8 rounded bg-faint flex items-center justify-center text-xs text-muted font-mono flex-shrink-0${item.iconUrl ? ' hidden' : ''}`}>
                {item.itemLevel > 0 ? item.itemLevel : '--'}
            </div>
        </>
    );
}

/** Single equipment slot with item display or empty placeholder */
export function EquipmentSlot({ item, slotName, gameVariant, onItemClick }: {
    item: EquipmentItemDto | undefined; slotName: string;
    gameVariant: string | null; onItemClick?: (() => void) | undefined;
}) {
    const [showFallback, setShowFallback] = useState(false);
    const isMobile = useMediaQuery('(max-width: 768px)');
    if (!item) return <EmptySlot slotName={slotName} />;

    const qualityClass = QUALITY_COLORS[item.quality.toUpperCase()] ?? 'text-secondary';
    const iconBorderClass = QUALITY_BORDERS[item.quality.toUpperCase()] ?? 'border-gray-500';

    return (
        <div className="relative flex items-center gap-3 p-2 rounded bg-overlay border border-edge min-h-[52px] cursor-pointer hover:bg-overlay/80 transition-colors"
            onClick={onItemClick} onMouseEnter={() => setShowFallback(true)} onMouseLeave={() => setShowFallback(false)}>
            <SlotIcon item={item} iconBorderClass={iconBorderClass} />
            <SlotItemDetails item={item} qualityClass={qualityClass} gameVariant={gameVariant} isMobile={isMobile} />
            {showFallback && !isMobile && !isWowheadLoaded() && <ItemFallbackTooltip item={item} />}
        </div>
    );
}

function SlotSockets({ sockets }: { sockets: EquipmentItemDto['sockets'] }) {
    if (!sockets || sockets.length === 0) return null;
    return (
        <div className="flex items-center gap-1">
            {sockets.map((s, i) => (
                <span key={i} className={`w-3 h-3 rounded-full border ${s.itemId ? 'bg-blue-500/40 border-blue-500/60' : 'bg-faint border-edge'}`}
                    title={`${s.socketType}${s.itemId ? ' (filled)' : ' (empty)'}`} />
            ))}
        </div>
    );
}

/** Item name, slot label, subclass, enchantments and sockets */
function SlotItemDetails({ item, qualityClass, gameVariant, isMobile }: {
    item: EquipmentItemDto; qualityClass: string; gameVariant: string | null; isMobile: boolean;
}) {
    const firstEnchant = item.enchantments?.[0];
    return (
        <div className="min-w-0 flex-1">
            <a href={getWowheadItemUrl(item.itemId, itemWowheadVariant(item, gameVariant))}
                data-wowhead={isMobile ? undefined : getWowheadItemData(item.itemId, itemWowheadVariant(item, gameVariant))}
                target="_blank" rel="noopener noreferrer" className={`text-sm font-medium truncate block ${qualityClass} hover:underline`}
                onClick={(e) => e.preventDefault()}>{item.name}</a>
            <div className="flex items-center gap-2 text-xs text-muted">
                <span>{SLOT_LABELS[item.slot] ?? item.slot}</span>
                {item.itemSubclass && (<><span>·</span><span>{item.itemSubclass}</span></>)}
            </div>
            {firstEnchant && <div className="text-xs text-green-400 truncate">{firstEnchant.displayString}</div>}
            <SlotSockets sockets={item.sockets} />
        </div>
    );
}

function SlotColumn({ slots, itemsBySlot, gameVariant, onItemClick }: {
    slots: string[]; itemsBySlot: Map<string, EquipmentItemDto>;
    gameVariant: string | null; onItemClick: (item: EquipmentItemDto) => void;
}) {
    return (
        <div className="space-y-2">
            {slots.map((slot) => (
                <EquipmentSlot key={slot} item={itemsBySlot.get(slot)} slotName={slot}
                    gameVariant={gameVariant}
                    onItemClick={itemsBySlot.get(slot) ? () => onItemClick(itemsBySlot.get(slot)!) : undefined} />
            ))}
        </div>
    );
}

/** Equipment grid with responsive paperdoll layout */
export function EquipmentGrid({ equipment, gameVariant, renderUrl, portrait, onItemClick }: {
    equipment: CharacterEquipmentDto; gameVariant: string | null;
    renderUrl: string | null; onItemClick: (item: EquipmentItemDto) => void;
    /** ROK-1747: the Forever fallback portrait, shown in the render slot when `renderUrl` is null. */
    portrait?: ForeverPortrait | undefined;
}) {
    const itemsBySlot = new Map(equipment.items.map((i) => [i.slot, i]));
    const columnProps = { itemsBySlot, gameVariant, onItemClick };
    const renderCenter = pickCenter(renderUrl, portrait);

    return (
        <div className="space-y-4">
            {renderCenter ? (
                <EquipmentWithCenter center={renderCenter} renderSlotColumn={(slots: string[]) => <SlotColumn slots={slots} {...columnProps} />} />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <SlotColumn slots={LEFT_SLOTS} {...columnProps} />
                    <SlotColumn slots={RIGHT_SLOTS} {...columnProps} />
                </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {BOTTOM_SLOTS.map((slot) => (
                    <EquipmentSlot key={slot} item={itemsBySlot.get(slot)} slotName={slot}
                        gameVariant={gameVariant} onItemClick={itemsBySlot.get(slot) ? () => onItemClick(itemsBySlot.get(slot)!) : undefined} />
                ))}
            </div>
        </div>
    );
}

type RenderLayout = 'desktop' | 'mobile';
type CenterRenderer = (layout: RenderLayout) => JSX.Element;
/** The centre column's content; `fill` = the Blizzard render, which takes a fixed track and the full column height. */
interface CenterSlot { render: CenterRenderer; fill: boolean }

/** The render slot's content: the Blizzard render wins, else the Forever portrait, else nothing (2-col grid). */
function pickCenter(renderUrl: string | null, portrait: ForeverPortrait | undefined): CenterSlot | null {
    if (renderUrl) return { fill: true, render: (layout) => <RenderImage renderUrl={renderUrl} layout={layout} /> };
    if (!portrait || portrait.kind === 'none') return null;
    return {
        fill: false,
        render: () => (
            <div data-testid="equipment-portrait">
                <ForeverPortraitTile key={portraitKey(portrait)} portrait={portrait} size="lg" />
            </div>
        ),
    };
}

/**
 * Ratio hints for the character render, per layout (ROK-1159). The API prefers
 * Blizzard's `main-raw` (a transparent PNG with a lot of padding around the
 * figure) and falls back to `main` (the same framing over a backdrop scene).
 * ROK-2157: the CSS box is explicit (`w-full` + `h-full`/`h-[300px]`), so these
 * attributes never become the painted size; `object-cover` crops the padding
 * and the 50%/35% focus keeps the head and torso in frame. On `main` the crop
 * only trims backdrop at the edges, which is fine. The render is the character
 * page's likely LCP image, so it is never lazy-loaded.
 */
const RENDER_BOX_DESKTOP = { width: 800, height: 600 } as const;
const RENDER_BOX_MOBILE = { width: 400, height: 300 } as const;
const RENDER_FIT = 'object-cover object-[50%_35%] drop-shadow-lg';

/** The Blizzard character render for one layout; a dead URL hides the image. */
function RenderImage({ renderUrl, layout }: { renderUrl: string; layout: RenderLayout }) {
    if (layout === 'desktop') {
        // Absolutely placed so the image never sizes the grid row: the slot columns set the
        // height, the frame fills it (min 24rem so a short column can't shrink the figure).
        return (
            <div data-testid="equipment-render-frame" className="relative w-full min-h-[24rem] self-stretch overflow-hidden">
                <img src={renderUrl} alt="Character render" {...RENDER_BOX_DESKTOP}
                    className={`absolute inset-0 h-full w-full ${RENDER_FIT}`}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            </div>
        );
    }
    return (
        <img src={renderUrl} alt="Character render" {...RENDER_BOX_MOBILE}
            className={`h-[300px] w-full ${RENDER_FIT}`}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
    );
}

/**
 * Desktop (3-col) and mobile (stacked) layouts with a centre column: the render image or the portrait.
 * ROK-2157: the render gets a fixed 14–20rem track and a centre cell stretched to the slot columns'
 * height (an `auto` track let preflight's img max-width shrink it to a ~100px figure); the portrait
 * tile keeps the `auto` track and its top-aligned cell.
 * ROK-2146: they switch on the PANEL's width (container query), not the viewport — beside the
 * character page's 320px sidebar the panel is ~600px at 1024 and ~856px at 1280, so the 3-col
 * render needs a >= lg viewport AND `@3xl` (48rem) of panel. Below lg and on full-width
 * pages (a ~944px panel at lg) nothing changes.
 */
const WIDE_GRID = {
    fill: 'hidden lg:@3xl:grid lg:@3xl:grid-cols-[1fr_minmax(14rem,20rem)_1fr] gap-4 items-start',
    tile: 'hidden lg:@3xl:grid lg:@3xl:grid-cols-[1fr_auto_1fr] gap-4 items-start',
} as const;
const WIDE_CENTRE = {
    fill: 'flex justify-center self-stretch overflow-hidden',
    tile: 'flex items-center justify-center px-2',
} as const;

function EquipmentWithCenter({ center, renderSlotColumn }: {
    center: CenterSlot; renderSlotColumn: (slots: string[]) => JSX.Element;
}) {
    const kind = center.fill ? 'fill' : 'tile';
    return (
        <div data-testid="equipment-layout" className="@container">
            <div data-testid="equipment-layout-wide" className={WIDE_GRID[kind]}>
                {renderSlotColumn(LEFT_SLOTS)}
                <div data-testid="equipment-centre" className={WIDE_CENTRE[kind]}>
                    {center.render('desktop')}
                </div>
                {renderSlotColumn(RIGHT_SLOTS)}
            </div>
            <div data-testid="equipment-layout-narrow" className="lg:@3xl:hidden space-y-4">
                <div className="flex justify-center">
                    {center.render('mobile')}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {renderSlotColumn(LEFT_SLOTS)}
                    {renderSlotColumn(RIGHT_SLOTS)}
                </div>
            </div>
        </div>
    );
}
