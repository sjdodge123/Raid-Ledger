/**
 * ROK-1774 — react-big-calendar `dayColumnWrapper`: renders the column exactly as
 * the library default does (a div with RBC's className/style/ref) and appends the
 * marker ticks for that column's local day. With no layer context or no markers
 * it renders the same DOM as the default wrapper.
 */
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { markersForColumn } from './calendar-layer-events';
import { useCalendarLayerContext } from './calendar-layer-context';
import { LayerMarkerTick } from './LayerMarkerTick';

export interface LayerDayColumnWrapperProps {
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
    date?: Date;
}

export const LayerDayColumnWrapper = forwardRef<HTMLDivElement, LayerDayColumnWrapperProps>(
    function LayerDayColumnWrapper({ children, className, style, date }, ref) {
        const ctx = useCalendarLayerContext();
        const ticks = ctx && date ? markersForColumn(ctx.markers, date) : [];
        return (
            <div ref={ref} className={className} style={style}>
                {children}
                {ticks.map((m) => <LayerMarkerTick key={m.id} marker={m} />)}
            </div>
        );
    },
);
