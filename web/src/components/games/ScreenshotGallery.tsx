import { useState, useCallback } from 'react';

interface ScreenshotGalleryProps {
    screenshots: string[];
    gameName: string;
}

export function ScreenshotGallery({ screenshots, gameName }: ScreenshotGalleryProps) {
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

    const handleError = useCallback((url: string) => {
        setFailedUrls((prev) => new Set(prev).add(url));
    }, []);

    const visibleScreenshots = screenshots.filter((url) => !failedUrls.has(url));

    if (visibleScreenshots.length === 0) return null;

    return (
        <>
            {/* Horizontal scroll gallery */}
            <div
                className="flex gap-3 overflow-x-auto pb-2"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {visibleScreenshots.map((url, i) => (
                    <button
                        key={url}
                        onClick={() => setLightboxIndex(i)}
                        className="flex-shrink-0 rounded-lg overflow-hidden hover:ring-2 hover:ring-emerald-500 transition-all"
                    >
                        <img
                            src={url}
                            alt={`${gameName} screenshot ${i + 1}`}
                            className="h-36 w-auto object-cover"
                            loading="lazy"
                            onError={() => handleError(url)}
                        />
                    </button>
                ))}
            </div>

            {/* Lightbox modal */}
            {lightboxIndex !== null && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
                    onClick={() => setLightboxIndex(null)}
                >
                    {/* Close button */}
                    <button
                        onClick={() => setLightboxIndex(null)}
                        className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors"
                        aria-label="Close"
                    >
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>

                    {/* Previous */}
                    {lightboxIndex > 0 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setLightboxIndex(lightboxIndex - 1);
                            }}
                            className="absolute left-4 p-2 text-white/70 hover:text-white transition-colors"
                            aria-label="Previous"
                        >
                            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                    )}

                    {/* Image */}
                    <img
                        src={visibleScreenshots[lightboxIndex]}
                        alt={`${gameName} screenshot ${lightboxIndex + 1}`}
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                    />

                    {/* Next */}
                    {lightboxIndex < visibleScreenshots.length - 1 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setLightboxIndex(lightboxIndex + 1);
                            }}
                            className="absolute right-4 p-2 text-white/70 hover:text-white transition-colors"
                            aria-label="Next"
                        >
                            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    )}

                    {/* Counter */}
                    <div className="absolute bottom-4 text-white/60 text-sm">
                        {lightboxIndex + 1} / {visibleScreenshots.length}
                    </div>
                </div>
            )}
        </>
    );
}
