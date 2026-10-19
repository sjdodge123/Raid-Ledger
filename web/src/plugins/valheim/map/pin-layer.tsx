/**
 * ROK-1837 D8 — pins as buttons in texture px. Each is counter-scaled
 * (`scale(1/zoom)`) so it keeps its on-screen size; a tap/Enter toggles its
 * label, hover/focus shows it, and from 2× zoom every label shows. Pins from
 * a cartography table (`shared`) render only while that layer is on.
 */
import { useState } from 'react';
import type { ValheimMapGrid, ValheimMapPin } from '@raid-ledger/contract';
import { worldToScreen } from './valheim-grid';
import {
    PIN_CHECKED_CLASS,
    PIN_DISC_CLASS,
    pinDisplayLabel,
    pinStyleFor,
} from './pin-types';

/** Zoom at and above which every pin label is shown (D8). */
export const PIN_LABELS_ALWAYS_SCALE = 2;

const BUTTON_CLASS =
    'group pointer-events-auto absolute flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success';
const LABEL_CLASS =
    'pointer-events-none absolute bottom-[calc(100%-4px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-edge bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground';

interface PinButtonProps {
    pin: ValheimMapPin;
    grid: ValheimMapGrid;
    scale: number;
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
}

function PinButton({
    pin,
    grid,
    scale,
    open,
    onToggle,
    onClose,
}: PinButtonProps) {
    const { Icon, toneClass } = pinStyleFor(pin.type);
    const text = pinDisplayLabel(pin.label, pin.type);
    const { left, top } = worldToScreen(grid, pin.x, pin.z);
    const shown = open || scale >= PIN_LABELS_ALWAYS_SCALE;
    const disc = pin.shared
        ? 'border-dashed border-slot'
        : 'border-edge-strong';
    return (
        <button
            type="button"
            aria-label={`${text} (${pin.type})`}
            aria-expanded={open}
            data-checked={pin.checked}
            className={
                pin.checked
                    ? `${BUTTON_CLASS} ${PIN_CHECKED_CLASS}`
                    : BUTTON_CLASS
            }
            style={{
                left,
                top,
                transform: `translate(-50%, -50%) scale(${1 / scale})`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={onToggle}
            onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
            }}
        >
            <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border ${disc} ${PIN_DISC_CLASS}`}
            >
                <Icon aria-hidden="true" className={`h-4 w-4 ${toneClass}`} />
            </span>
            <span
                aria-hidden="true"
                data-open={shown}
                className={`${LABEL_CLASS} ${shown ? 'block' : 'hidden group-hover:block group-focus-visible:block'}`}
            >
                {text}
            </span>
        </button>
    );
}

export interface PinLayerProps {
    grid: ValheimMapGrid;
    pins: readonly ValheimMapPin[];
    /** Current viewport zoom — pins counter-scale by `1/scale`. */
    scale: number;
    /** The shared (cartography table) layer toggle. */
    showShared: boolean;
}

export function PinLayer({ grid, pins, scale, showShared }: PinLayerProps) {
    const [openKey, setOpenKey] = useState<string | null>(null);
    const size = grid.textureSize;
    return (
        <div
            className="pointer-events-none absolute left-0 top-0"
            style={{ width: size, height: size }}
        >
            {pins.map((pin, i) => {
                if (pin.shared && !showShared) return null;
                const key = `${i}:${pin.type}:${pin.x}:${pin.z}`;
                return (
                    <PinButton
                        key={key}
                        pin={pin}
                        grid={grid}
                        scale={scale}
                        open={openKey === key}
                        onToggle={() =>
                            setOpenKey(openKey === key ? null : key)
                        }
                        onClose={() => setOpenKey(null)}
                    />
                );
            })}
        </div>
    );
}
