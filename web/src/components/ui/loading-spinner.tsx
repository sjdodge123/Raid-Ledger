/**
 * Full-page loading spinner used as Suspense fallback for lazy-loaded routes.
 */
export function LoadingSpinner() {
    return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
        </div>
    );
}
