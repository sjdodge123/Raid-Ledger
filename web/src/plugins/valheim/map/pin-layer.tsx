/**
 * ROK-1837 D8 — pins as buttons in texture px. Each is counter-scaled
 * (`scale(1/zoom)`) so it keeps its on-screen size; a tap/Enter toggles its
 * label, hover/focus shows it (Escape hides it until focus/hover leaves), and
 * from 2× zoom every label shows. Pins from
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

interface PinLabelProps {
    text: string;
    shown: boolean;
    /** Crossed out — on the label itself: a decoration on the button never reaches this out-of-flow span. */
    checked: boolean;
    /** Escape-dismissed: hover/focus no longer reveal it until they leave the pin. */
    dismissed: boolean;
}

function labelVisibility(shown: boolean, dismissed: boolean): string {
    if (shown) return 'block';
    if (dismissed) return 'hidden';
    return 'hidden group-hover:block group-focus-visible:block';
}

function PinLabel({ text, shown, checked, dismissed }: PinLabelProps) {
    const visibility = labelVisibility(shown, dismissed);
    const strike = checked ? ' line-through' : '';
    return (
        <span
            aria-hidden="true"
            data-open={shown}
            className={`${LABEL_CLASS} ${visibility}${strike}`}
        >
            {text}
        </span>
    );
}

interface PinCallbacks {
    onToggle: () => void;
    /** Escape: close the label, incl. a hover/focus one. */
    onClose: () => void;
    /** Focus or pointer left the pin: hover/focus may show its label again. */
    onLeave: () => void;
}

/** Keep pin gestures off the viewport (no pan/zoom from a pin tap). */
function pinHandlers({ onToggle, onClose, onLeave }: PinCallbacks) {
    return {
        onPointerDown: (e: PointerEvent) => e.stopPropagation(),
        onDoubleClick: (e: MouseEvent) => e.stopPropagation(),
        onClick: onToggle,
        onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        },
        onBlur: onLeave,
        onPointerLeave: onLeave,
    };
}

/** Position in texture px, counter-scaled to keep its screen size; checked = struck through. */
function pinPlacement(pin: ValheimMapPin, grid: ValheimMapGrid, scale: number) {
    const { left, top } = worldToScreen(grid, pin.x, pin.z);
    return {
        className: pin.checked
            ? `${BUTTON_CLASS} ${PIN_CHECKED_CLASS}`
            : BUTTON_CLASS,
        style: {
            left,
            top,
            transform: `translate(-50%, -50%) scale(${1 / scale})`,
        },
    };
}

interface PinButtonProps {
    pin: ValheimMapPin;
    grid: ValheimMapGrid;
    scale: number;
    open: boolean;
    dismissed: boolean;
    labels: boolean;
    callbacks: PinCallbacks;
}

function PinButton(props: PinButtonProps) {
    const { pin, grid, scale, open, dismissed, labels, callbacks } = props;
    const text = pinDisplayLabel(pin.label, pin.type);
    return (
        <button
            type="button"
            aria-label={`${text} (${pin.type})`}
            aria-expanded={open}
            data-checked={pin.checked}
            {...pinPlacement(pin, grid, scale)}
            {...pinHandlers(callbacks)}
        >
            <PinDisc pin={pin} />
            <PinLabel
                text={text}
                checked={pin.checked}
                dismissed={dismissed}
                shown={open || labels || scale >= PIN_LABELS_ALWAYS_SCALE}
            />
        </button>
    );
}

/** Which pin's label is tapped open, and which one Escape dismissed until focus/hover leaves it. */
function usePinLabelState() {
    const [openKey, setOpenKey] = useState<string | null>(null);
    const [dismissedKey, setDismissedKey] = useState<string | null>(null);
    const callbacksFor = (key: string): PinCallbacks => ({
        onToggle: () => setOpenKey(openKey === key ? null : key),
        onClose: () => {
            setOpenKey(null);
            setDismissedKey(key);
        },
        onLeave: () => {
            if (dismissedKey === key) setDismissedKey(null);
        },
    });
    return { openKey, dismissedKey, callbacksFor };
}

export interface PinLayerProps {
    grid: ValheimMapGrid;
    pins: readonly ValheimMapPin[];
    /** Current viewport zoom — pins counter-scale by `1/scale`. */
    scale: number;
    /** The shared (cartography table) layer toggle. */
    showShared: boolean;
    /** The "Pin labels" switch (D9): every label shown at any zoom. */
    labels?: boolean;
}

export function PinLayer(props: PinLayerProps) {
    const { grid, pins, scale, showShared, labels = false } = props;
    const { openKey, dismissedKey, callbacksFor } = usePinLabelState();
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
                        dismissed={dismissedKey === key}
                        labels={labels}
                        callbacks={callbacksFor(key)}
                    />
                );
            })}
        </div>
    );
}
