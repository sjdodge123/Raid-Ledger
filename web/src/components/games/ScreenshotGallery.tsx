import { useState, useCallback, useEffect } from 'react';
import { SCREENSHOT_INTRINSIC, screenshotSrcSetProps } from '../../lib/igdb-image';

/** Viewport width at which 90vw reaches the screenshot's 889px intrinsic width. */
const LIGHTBOX_VW_BREAKPOINT = Math.ceil(SCREENSHOT_INTRINSIC.width / 0.9);

/** `h-36` (144px) at the 889x500 aspect ratio paints a 256px-wide thumb. */
const THUMB_SIZES = '256px';

interface ScreenshotGalleryProps {
    screenshots: string[];
    gameName: string;
}

function LightboxNav({ direction, onClick }: { direction: 'prev' | 'next'; onClick: (e: React.MouseEvent) => void }) {
    const path = direction === 'prev' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7';
    const position = direction === 'prev' ? 'left-4' : 'right-4';
    return (
        <button onClick={onClick} className={`absolute ${position} p-2 text-white/70 hover:text-white transition-colors`} aria-label={direction === 'prev' ? 'Previous' : 'Next'}>
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
            </svg>
        </button>
    );
}

/**
 * The opened screenshot. Not lazy: the user asked for it. It paints at
 * `max-w-[90vw]` capped by its 889px intrinsic width, which is what `sizes` says.
 * No width/height attributes: the overlay is fixed, so there is no layout to
 * protect, and a width attribute would pin the box at min(889px, 90vw). On a
 * short viewport `max-h` would then letterbox the picture instead of scaling it.
 */
function LightboxImage({ url, alt }: { url: string; alt: string }) {
    return (
        <img src={url} alt={alt} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" decoding="async"
            {...screenshotSrcSetProps(url, `(max-width: ${LIGHTBOX_VW_BREAKPOINT}px) 90vw, ${SCREENSHOT_INTRINSIC.width}px`)}
            onClick={(e) => e.stopPropagation()} />
    );
}

function Lightbox({ screenshots, index, gameName, onClose, onNav }: {
    screenshots: string[]; index: number; gameName: string; onClose: () => void; onNav: (i: number) => void;
}) {
    useEffect(() => {
        const handleKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>
            <button onClick={onClose} className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors" aria-label="Close">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            {index > 0 && <LightboxNav direction="prev" onClick={(e) => { e.stopPropagation(); onNav(index - 1); }} />}
            <LightboxImage url={screenshots[index]} alt={`${gameName} screenshot ${index + 1}`} />
            {index < screenshots.length - 1 && <LightboxNav direction="next" onClick={(e) => { e.stopPropagation(); onNav(index + 1); }} />}
            <div className="absolute bottom-4 text-white/60 text-sm">{index + 1} / {screenshots.length}</div>
        </div>
    );
}

export function ScreenshotGallery({ screenshots, gameName }: ScreenshotGalleryProps) {
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());
    const handleError = useCallback((url: string) => { setFailedUrls((prev) => new Set(prev).add(url)); }, []);
    const visibleScreenshots = screenshots.filter((url) => !failedUrls.has(url));

    if (visibleScreenshots.length === 0) return null;

    return (
        <>
            <div className="flex gap-3 overflow-x-auto p-1 -m-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {visibleScreenshots.map((url, i) => (
                    <button key={url} onClick={() => setLightboxIndex(i)} className="flex-shrink-0 rounded-lg overflow-hidden ring-2 ring-transparent hover:ring-emerald-500 transition-all">
                        <img src={url} alt={`${gameName} screenshot ${i + 1}`} className="h-36 w-auto object-cover"
                            width={SCREENSHOT_INTRINSIC.width} height={SCREENSHOT_INTRINSIC.height} loading="lazy" decoding="async"
                            {...screenshotSrcSetProps(url, THUMB_SIZES)} onError={() => handleError(url)} />
                    </button>
                ))}
            </div>
            {lightboxIndex !== null && <Lightbox screenshots={visibleScreenshots} index={lightboxIndex} gameName={gameName} onClose={() => setLightboxIndex(null)} onNav={setLightboxIndex} />}
        </>
    );
}
