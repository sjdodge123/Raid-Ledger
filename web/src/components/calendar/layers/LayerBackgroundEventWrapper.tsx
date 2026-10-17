/**
 * ROK-1774 — react-big-calendar 1.20 renders every time-grid event, background
 * events included, as `role="button" tabIndex={0}` and wraps it in
 * `components.eventWrapper` (its `backgroundEventWrapper` default is never
 * used by the time grid). A layer band is decoration, not a control, so for
 * layer items only this drops the button role and the tab stop. Calendar
 * events pass through untouched and stay focusable.
 */
import { cloneElement, isValidElement, type HTMLAttributes, type ReactNode } from 'react';
import { isLayerEvent } from './calendar-layer-events';

interface LayerBackgroundEventWrapperProps {
    event: object;
    children?: ReactNode;
}

export function LayerBackgroundEventWrapper({ event, children }: LayerBackgroundEventWrapperProps) {
    if (!isLayerEvent(event) || !isValidElement<HTMLAttributes<HTMLElement>>(children)) return <>{children}</>;
    return cloneElement(children, { role: undefined, tabIndex: undefined });
}
