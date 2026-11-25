/**
 * ROK-2370: "Sign in not working? Try another way" — the login page's
 * disclosure for sign-in workarounds (operator ruling 2026-11-25 17:26Z).
 *
 * The body is an ordered list of sections, one open at a time: today the
 * Discord-app code, then username/password. The list is the extension point
 * for later workarounds; top-level providers (Discord, ROK-2371's Google)
 * never go in here.
 */
import type { JSX, ReactNode } from 'react';
import { useId, useState } from 'react';
import { Button } from '../../components/ui/button';

export type SignInSectionId = 'discord-app-code' | 'password';

/** One workaround inside the disclosure. */
export interface SignInSection {
    id: SignInSectionId;
    /** Label of the collapsed row (and the sub-heading when `showHeading`). */
    title: string;
    /** Show `title` as a sub-heading while the section is open. */
    showHeading: boolean;
    node: ReactNode;
}

export const TRY_ANOTHER_WAY_LABEL = 'Sign in not working? Try another way';
export const ANOTHER_WAY_HEADING = 'Sign in another way';

function pickSection(sections: SignInSection[], wanted: SignInSectionId | undefined): SignInSectionId | undefined {
    return sections.find((s) => s.id === wanted)?.id ?? sections[0]?.id;
}

/** The open section, or the collapsed row that opens it. */
function SectionRow({ section, active, onOpen }: {
    section: SignInSection; active: boolean; onOpen: () => void;
}): JSX.Element {
    if (!active) {
        return (
            <div className="text-center">
                <Button variant="ghost" size="sm" aria-expanded={false} onClick={onOpen}>{section.title}</Button>
            </div>
        );
    }
    return (
        <section data-section={section.id} className="space-y-3">
            {section.showHeading && <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>}
            {section.node}
        </section>
    );
}

/** The quiet trigger link plus the sections it reveals. */
export function SignInAnotherWay({ sections, intro = null, defaultOpen = false, initialSection, onClose }: {
    sections: SignInSection[];
    intro?: string | null;
    defaultOpen?: boolean;
    initialSection?: SignInSectionId | undefined;
    /** Called when the member closes the disclosure (drops a pending code). */
    onClose?: () => void;
}): JSX.Element {
    const [open, setOpen] = useState(defaultOpen);
    const [active, setActive] = useState(() => pickSection(sections, initialSection));
    const bodyId = useId();
    const toggle = (): void => {
        if (open) onClose?.();
        setOpen(!open);
    };
    const current = pickSection(sections, active);
    return (
        <div className="mt-6">
            <div className="text-center">
                <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
                    {TRY_ANOTHER_WAY_LABEL}
                </Button>
            </div>
            {open && (
                <div id={bodyId} className="mt-4 pt-4 border-t border-edge space-y-4" data-testid="signin-another-way">
                    <div className="space-y-1">
                        <h2 className="text-sm font-semibold text-foreground">{ANOTHER_WAY_HEADING}</h2>
                        {intro && <p className="text-sm text-secondary">{intro}</p>}
                    </div>
                    {sections.map((section) => (
                        <SectionRow key={section.id} section={section} active={section.id === current}
                            onOpen={() => setActive(section.id)} />
                    ))}
                </div>
            )}
        </div>
    );
}
