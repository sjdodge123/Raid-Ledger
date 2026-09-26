/**
 * Full-page loading spinner used as Suspense fallback for lazy-loaded routes.
 * role="status" + aria-label give it a name in Playwright's aria snapshot
 * (error-context.md omits data-testid), so a pending route chunk reads as
 * "Loading page" rather than an anonymous `generic`.
 */
export function LoadingSpinner() {
    return (
        <div
            data-testid="loading-spinner"
            role="status"
            aria-label="Loading page"
            className="flex items-center justify-center min-h-[60vh]"
        >
            <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
        </div>
    );
}
