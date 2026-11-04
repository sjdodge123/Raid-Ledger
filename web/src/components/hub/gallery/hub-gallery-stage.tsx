/**
 * ROK-2075 — the viewer's focusable region + zoomable picture well, shared by the list viewer and the
 * single-picture view (ROK-2074). Owns `useGalleryZoom`: the stage takes the pointer handlers and the
 * ctrl-wheel listener, the `<img>` the transform, the region (focused on mount) the `+ - 0` / arrow keys —
 * an arrow pans while zoomed and stops there, so the dialog's ←/→ walk pictures only at fit.
 * `resetKey` (the picture) returns to fit; closing unmounts it.
 */
import { lazy, Suspense, useEffect, useRef, type JSX, type ReactNode, type RefObject } from 'react';
import { type GallerySwipe, useGalleryZoom } from './use-gallery-zoom';

/**
 * The controls are their own chunk: their heroicons sit in a chunk shared with the Valheim map controls, and a
 * static import put that chunk in the hub page's preload list for the dialog (`hub-page` over its bundle budget).
 * The fetch starts when this module evaluates (the dialog chunk), so the controls are normally ready with the picture.
 */
const loadZoomControls = () => import('./hub-gallery-zoom-controls');
void loadZoomControls();
const HubGalleryZoomControls = lazy(() => loadZoomControls().then((m) => ({ default: m.HubGalleryZoomControls })));

const STAGE_CLASS = 'relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-media-well lg:aspect-video';

/** Coming from the grid, the clicked tile is gone: keep focus inside the dialog. */
function useFocusRegionOnMount(): RefObject<HTMLDivElement | null> {
    const region = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = region.current;
        if (el !== null && !el.contains(document.activeElement)) el.focus();
    }, []);
    return region;
}

export interface HubGalleryStagePicture {
    src: string;
    alt: string;
    onError?: () => void;
}

export interface HubGalleryStageProps {
    resetKey: unknown;
    onSwipe?: (direction: GallerySwipe) => void;
    testId: string;
    className: string;
    mediaId?: number;
    /** Null while loading / failed: `placeholder` shows instead. */
    picture: HubGalleryStagePicture | null;
    placeholder: ReactNode;
    /** Above the well ("3 of 24"). */
    header?: ReactNode;
    /** Over the well, beside the zoom controls (Prev / Next). */
    overlay?: ReactNode;
    /** Under the well (the caption). */
    footer?: ReactNode;
}

export function HubGalleryStage({ resetKey, onSwipe, testId, className, mediaId, picture, placeholder, header, overlay, footer }: HubGalleryStageProps): JSX.Element {
    const region = useFocusRegionOnMount();
    const { bindStage, bindContent, handlers, onKeyDown, stageStyle, contentStyle, zoom, announcedZoom, atFit, animating, canZoomIn, canZoomOut, zoomIn, zoomOut, fit } =
        useGalleryZoom(onSwipe === undefined ? { resetKey } : { resetKey, onSwipe });
    const motion = animating ? ' motion-safe:transition-transform motion-safe:duration-150' : '';
    return (
        <div ref={region} tabIndex={-1} className={className} data-testid={testId} data-media-id={mediaId} onKeyDown={onKeyDown}>
            {header}
            <div ref={bindStage} {...handlers} style={stageStyle} data-testid="hub-gallery-stage" data-zoom={zoom.toFixed(2)}
                data-zoomed={atFit ? undefined : ''} className={STAGE_CLASS}>
                {picture === null
                    ? placeholder
                    : <img ref={bindContent} src={picture.src} alt={picture.alt} onError={picture.onError} style={contentStyle} draggable={false}
                        className={`max-h-full max-w-full select-none object-contain [-webkit-touch-callout:none]${motion}`} />}
                {overlay}
                <Suspense fallback={null}>
                    <HubGalleryZoomControls readoutZoom={announcedZoom} atFit={atFit} canZoomIn={canZoomIn} canZoomOut={canZoomOut} zoomIn={zoomIn} zoomOut={zoomOut} fit={fit} />
                </Suspense>
            </div>
            {footer}
        </div>
    );
}
