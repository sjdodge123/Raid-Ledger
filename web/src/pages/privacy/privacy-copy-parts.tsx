/** ROK-1778: inline pieces the privacy copy is written with. Tokens only. */
import type { ReactNode } from 'react';

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            {children}
        </a>
    );
}

/** The bold lead-in of a policy bullet ("What we read."). */
export function Lead({ children }: { children: ReactNode }) {
    return <strong className="text-foreground">{children}</strong>;
}
