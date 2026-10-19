/** ROK-1837 — a failed map fetch: what failed, and a Retry (≥44px target). */
import { Button } from '../../../components/ui/button';

export function MapError({
    text,
    onRetry,
}: {
    text: string;
    onRetry: () => void;
}) {
    return (
        <div
            role="alert"
            className="flex flex-col items-center gap-3 py-12 text-center"
        >
            <p className="text-sm text-muted">{text}</p>
            <Button
                variant="secondary"
                size="sm"
                className="min-h-11"
                onClick={onRetry}
            >
                Retry
            </Button>
        </div>
    );
}
