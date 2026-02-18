/**
 * Global ARIA live region containers for screen reader announcements.
 * Render once near the root of the app (inside Layout).
 *
 * - `aria-live="polite"` — queued behind current speech (status updates)
 * - `aria-live="assertive"` — interrupts current speech (urgent alerts)
 *
 * Content is injected via `useAriaLive().announce()`.
 */
export function LiveRegionProvider() {
    return (
        <>
            <div
                id="aria-live-polite"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="sr-only"
            />
            <div
                id="aria-live-assertive"
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                className="sr-only"
            />
        </>
    );
}
