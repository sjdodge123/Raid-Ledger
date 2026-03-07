import { useState, useCallback } from 'react';

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

function Lightbox({ screenshots, index, gameName, onClose, onNav }: {
    screenshots: string[]; index: number; gameName: string; onClose: () => void; onNav: (i: number) => void;
}) {
    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>
            <button onClick={onClose} className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors" aria-label="Close">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            {index > 0 && <LightboxNav direction="prev" onClick={(e) => { e.stopPropagation(); onNav(index - 1); }} />}
            <img src={screenshots[index]} alt={`${gameName} screenshot ${index + 1}`} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
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
            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {visibleScreenshots.map((url, i) => (
                    <button key={url} onClick={() => setLightboxIndex(i)} className="flex-shrink-0 rounded-lg overflow-hidden hover:ring-2 hover:ring-emerald-500 transition-all">
                        <img src={url} alt={`${gameName} screenshot ${i + 1}`} className="h-36 w-auto object-cover" loading="lazy" onError={() => handleError(url)} />
                    </button>
                ))}
            </div>
            {lightboxIndex !== null && <Lightbox screenshots={visibleScreenshots} index={lightboxIndex} gameName={gameName} onClose={() => setLightboxIndex(null)} onNav={setLightboxIndex} />}
        </>
    );
}
