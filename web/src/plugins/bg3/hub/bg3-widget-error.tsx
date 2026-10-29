/** ROK-1958 — a quiet failure line + retry for the BG3 cards (403/404 hide them via `useVisible`). */
import type { JSX } from 'react';
import { Button } from '../../../components/ui/button';

export function Bg3WidgetError({ text, onRetry }: { text: string; onRetry: () => void }): JSX.Element {
    return (
        <div className="flex flex-col items-center gap-2 py-6 text-center" role="status">
            <p className="text-sm text-muted">{text}</p>
            <Button variant="ghost" size="sm" onClick={onRetry}>Try again</Button>
        </div>
    );
}
