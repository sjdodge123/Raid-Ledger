import { useState, useRef, useEffect } from 'react';
import { useThemeStore } from '../../stores/theme-store';

interface ScrollCollapsibleProps {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
    className?: string;
}

export function ScrollCollapsible({
    title,
    defaultOpen = false,
    children,
    className = '',
}: ScrollCollapsibleProps) {
    const resolved = useThemeStore((s) => s.resolved);
    const isQuestLog = resolved.id === 'quest-log';
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const contentRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState<number | undefined>(
        defaultOpen ? undefined : 0,
    );

    useEffect(() => {
        if (!contentRef.current) return;
        if (isOpen) {
            setHeight(contentRef.current.scrollHeight);
            const timer = setTimeout(() => setHeight(undefined), 200);
            return () => clearTimeout(timer);
        } else {
            setHeight(contentRef.current.scrollHeight);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => setHeight(0));
            });
        }
    }, [isOpen]);

    if (!isQuestLog) {
        return (
            <details className={className} open={defaultOpen || undefined}>
                <summary className="cursor-pointer font-medium text-foreground select-none">
                    {title}
                </summary>
                <div className="pt-3">{children}</div>
            </details>
        );
    }

    return (
        <details
            className={className}
            open={isOpen || undefined}
            onToggle={(e) => {
                const details = e.currentTarget as HTMLDetailsElement;
                setIsOpen(details.open);
            }}
        >
            <summary className="cursor-pointer font-medium text-foreground select-none">
                {title}
            </summary>
            <div
                ref={contentRef}
                style={{
                    height: height === undefined ? 'auto' : height,
                    overflow: 'hidden',
                    transition: 'height 0.2s ease',
                }}
            >
                <div className="p-4">{children}</div>
            </div>
        </details>
    );
}
