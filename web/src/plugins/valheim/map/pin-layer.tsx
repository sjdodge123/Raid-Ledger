/**
 * ROK-1837 D8 — pins as buttons in texture px. Each is counter-scaled
 * (`scale(1/zoom)`) so it keeps its on-screen size; a tap/Enter toggles its
 * label, hover/focus shows it, and from 2× zoom every label shows. Pins from
 * a cartography table (`shared`) render only while that layer is on.
 */
import { useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
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

function PinDisc({ pin }: { pin: ValheimMapPin }) {
    const { Icon, toneClass } = pinStyleFor(pin.type);
    const edge = pin.shared
        ? 'border-dashed border-slot'
        : 'border-edge-strong';
    return (
        <span
            className={`flex h-7 w-7 items-center justify-center rounded-full border ${edge} ${PIN_DISC_CLASS}`}
        >
            <Icon aria-hidden="true" className={`h-4 w-4 ${toneClass}`} />
        </span>
    );
}

function PinLabel({ text, shown }: { text: string; shown: boolean }) {
    const visibility = shown
        ? 'block'
        : 'hidden group-hover:block group-focus-visible:block';
    return (
        <span
            aria-hidden="true"
            data-open={shown}
            className={`${LABEL_CLASS} ${visibility}`}
        >
            {text}
        </span>
    );
}

/** Keep pin gestures off the viewport (no pan/zoom from a pin tap); Esc closes the label. */
function pinHandlers(onToggle: () => void, onClose: () => void) {
    return {
        onPointerDown: (e: PointerEvent) => e.stopPropagation(),
        onDoubleClick: (e: MouseEvent) => e.stopPropagation(),
        onClick: onToggle,
        onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        },
    };
}

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
    const text = pinDisplayLabel(pin.label, pin.type);
    const { left, top } = worldToScreen(grid, pin.x, pin.z);
    const transform = `translate(-50%, -50%) scale(${1 / scale})`;
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
            style={{ left, top, transform }}
            {...pinHandlers(onToggle, onClose)}
        >
            <PinDisc pin={pin} />
            <PinLabel
                text={text}
                shown={open || scale >= PIN_LABELS_ALWAYS_SCALE}
            />
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
