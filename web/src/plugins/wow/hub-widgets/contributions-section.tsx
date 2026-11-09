/** ROK-2148 — one titled section of the Guild contributions card; the card divides them with a hairline. */
import type { JSX, ReactNode } from 'react';

interface SectionProps {
    title: string;
    testId: string;
    /** Trailing control on the title row (the givers' period toggle). */
    action?: ReactNode;
    children: ReactNode;
}

export function ContributionsSection({ title, testId, action, children }: SectionProps): JSX.Element {
    return (
        <section data-testid={testId} className="py-3 first:pt-0 last:pb-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                {action}
            </div>
            {children}
        </section>
    );
}
