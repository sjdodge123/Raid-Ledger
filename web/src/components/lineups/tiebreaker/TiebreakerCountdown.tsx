/**
 * TiebreakerCountdown (ROK-938).
 * Round/reveal deadline countdown display.
 */
import { useState, useEffect, type JSX } from 'react';

interface Props {
    deadline: string | null;
}

function formatRemaining(ms: number): string {
    if (ms <= 0) return 'Expired';
    const hours = Math.floor(ms / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

export function TiebreakerCountdown({ deadline }: Props): JSX.Element | null {
    const [remaining, setRemaining] = useState('');

    useEffect(() => {
        if (!deadline) return;
        const update = () => {
            const ms = new Date(deadline).getTime() - Date.now();
            setRemaining(formatRemaining(ms));
        };
        update();
        const interval = setInterval(update, 30_000);
        return () => clearInterval(interval);
    }, [deadline]);

    if (!deadline) return null;

    return (
        <span className="text-xs text-muted">
            {remaining} remaining
        </span>
    );
}
