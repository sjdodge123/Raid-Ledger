/**
 * ROK-1814 — a hub's crest at one of today's box sizes (spec Q9): `sm` 24px
 * (nav rows, character badge), `md` 40px (phone hubs sheet), `lg` 48px
 * (cards), `hero` 64/80px. An upload renders its re-encoded image, a preset
 * paints its emblem in the contract palette (crest data — the design-system
 * colour exception; the frame and fallbacks use tokens). No crest, an unknown
 * source or an image that fails to load falls back as today (Q8): initials in
 * the hero, the shield on lists, or the caller's `fallback` (nav: game icon).
 * The emblem art is lazy (`crest-emblems-lazy.ts`): this file sits in the
 * always-loaded header, so the path data must not join the first page load.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { GUILD_CREST_PALETTE } from '@raid-ledger/contract';
import { useCrestEmblemArt } from './crest-emblems-lazy';
import { asCrestPreset, asCrestUpload, crestAssetUrl, crestInitials, type CrestPreset, type HubCrestInput } from './hub-crest.helpers';

export type HubCrestSize = 'sm' | 'md' | 'lg' | 'hero';

const LIST_FRAME = 'rounded-lg border border-edge-strong';
const BOX: Record<HubCrestSize, { box: string; frame: string; icon: string }> = {
    sm: { box: 'h-6 w-6', frame: LIST_FRAME, icon: 'h-4 w-4' },
    md: { box: 'h-10 w-10', frame: LIST_FRAME, icon: 'h-6 w-6' },
    lg: { box: 'h-12 w-12', frame: LIST_FRAME, icon: 'h-7 w-7' },
    hero: { box: 'h-16 w-16 sm:h-20 sm:w-20', frame: 'rounded-xl border-2 border-edge-strong', icon: 'h-10 w-10' },
};

export interface HubCrestProps {
    crest: HubCrestInput;
    /** The hub name: initials for the hero fallback. */
    name: string;
    size: HubCrestSize;
    /** Replaces the default fallback (initials for `hero`, the shield otherwise). */
    fallback?: ReactNode;
    /** Layout classes for the box (e.g. the hero's grid cell). */
    className?: string | undefined;
}

function boxClass(size: HubCrestSize, extra: string, className: string | undefined): string {
    const { box, frame } = BOX[size];
    return ['flex shrink-0 items-center justify-center', box, frame, extra, className].filter(Boolean).join(' ');
}

function CrestFallback({ name, size, fallback, className }: Omit<HubCrestProps, 'crest'>): JSX.Element {
    if (fallback !== undefined) return <>{fallback}</>;
    if (size === 'hero') {
        return (
            <div aria-hidden="true" data-testid="hub-crest" data-crest="initials"
                className={boxClass(size, 'bg-surface text-xl font-bold text-secondary sm:text-2xl', className)}>
                {crestInitials(name)}
            </div>
        );
    }
    return (
        <span aria-hidden="true" data-testid="hub-crest" data-crest="shield" className={boxClass(size, 'bg-overlay text-success', className)}>
            <ShieldCheckIcon className={BOX[size].icon} />
        </span>
    );
}

/** Every emblem's grid; the empty svg holds the box while the art chunk loads. */
const EMBLEM_VIEWBOX = '0 0 512 512';

/**
 * The palette box paints at once; the emblem paths fill in once the lazy art
 * chunk lands. A chunk that fails to load shows the usual fallback instead.
 */
function PresetCrest({ preset, ...rest }: Omit<HubCrestProps, 'crest'> & { preset: CrestPreset }): JSX.Element {
    const { size, className } = rest;
    const { status, art } = useCrestEmblemArt(preset.emblemId);
    if (status === 'failed') return <CrestFallback {...rest} />;
    return (
        <span aria-hidden="true" data-testid="hub-crest" data-crest="preset" className={boxClass(size, 'overflow-hidden', className)}
            style={{ backgroundColor: GUILD_CREST_PALETTE[preset.bg] }}>
            <svg viewBox={art?.viewBox ?? EMBLEM_VIEWBOX} className="h-3/4 w-3/4" data-testid="hub-crest-emblem" data-emblem={preset.emblemId}
                style={{ color: GUILD_CREST_PALETTE[preset.fg] }}>
                {art?.paths.map((d) => <path key={d} d={d} fill="currentColor" />)}
            </svg>
        </span>
    );
}

/** A hub's crest, or today's placeholder when it has none (see the file header for sizes and fallbacks). */
export function HubCrest(props: HubCrestProps): JSX.Element {
    const { crest, size, className } = props;
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const upload = asCrestUpload(crest);
    const src = upload ? crestAssetUrl(size === 'sm' || size === 'md' ? upload.urlSm : upload.urlLg) : null;
    if (src !== null && src !== failedSrc) {
        return (
            <span aria-hidden="true" data-testid="hub-crest" data-crest="upload" className={boxClass(size, 'overflow-hidden bg-surface', className)}>
                <img src={src} alt="" decoding="async" data-testid="hub-crest-img" className="h-full w-full object-cover"
                    onError={() => setFailedSrc(src)} />
            </span>
        );
    }
    const preset = asCrestPreset(crest);
    if (preset) return <PresetCrest {...props} preset={preset} />;
    return <CrestFallback name={props.name} size={size} fallback={props.fallback} className={className} />;
}
