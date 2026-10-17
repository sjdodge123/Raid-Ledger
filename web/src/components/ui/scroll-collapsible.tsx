import { useState, useRef, useEffect } from 'react';
import { useThemeStore } from '../../stores/theme-store';

interface ScrollCollapsibleProps {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
    className?: string;
}

function useAnimatedHeight(isOpen: boolean) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState<number | undefined>(isOpen ? undefined : 0);

    useEffect(() => {
        if (!contentRef.current) return;
        if (isOpen) {
            setHeight(contentRef.current.scrollHeight);
            const timer = setTimeout(() => setHeight(undefined), 200);
            return () => clearTimeout(timer);
        } else {
            setHeight(contentRef.current.scrollHeight);
            requestAnimationFrame(() => { requestAnimationFrame(() => setHeight(0)); });
        }
    }, [isOpen]);

    return { contentRef, height };
}

function SimpleDetails({ title, defaultOpen, className, children }: ScrollCollapsibleProps) {
    return (
        <details className={className} open={defaultOpen || undefined}>
            <summary className="cursor-pointer font-medium text-foreground select-none">{title}</summary>
            <div className="pt-3">{children}</div>
        </details>
    );
}

export function ScrollCollapsible({ title, defaultOpen = false, children, className = '' }: ScrollCollapsibleProps) {
    const resolved = useThemeStore((s) => s.resolved);
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const { contentRef, height } = useAnimatedHeight(isOpen);

    if (resolved.id !== 'quest-log') {
        return <SimpleDetails title={title} defaultOpen={defaultOpen} className={className}>{children}</SimpleDetails>;
    }

    return (
        <details
            className={className}
            open={isOpen || undefined}
            onToggle={(e) => setIsOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
            <summary className="cursor-pointer font-medium text-foreground select-none">{title}</summary>
            <div ref={contentRef} style={{ height: height === undefined ? 'auto' : height, overflow: 'hidden', transition: 'height 0.2s ease' }}>
                <div className="p-4">{children}</div>
            </div>
        </details>
    );
}
