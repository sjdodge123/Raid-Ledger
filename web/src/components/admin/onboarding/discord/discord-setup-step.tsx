/**
 * ROK-1703 — the wizard's "Discord" step (index 2): a sub-step rail plus one
 * of five screens. The screen starts at the DERIVED sub-step (D-2) and then
 * follows Continue / Back / the rail. Back on 4a leaves the step; Continue on
 * the last screen moves the wizard on.
 *
 * The first derivation is latched: a later change (the bot joining while a
 * resumed admin waits on 4d) must not swap the screen under them. 4d shows
 * the join and enables Continue (AC-8); only Continue moves on to 4e.
 */
import { useState, type JSX } from 'react';
import { LoadingSpinner } from '../../../ui/loading-spinner';
import { DiscordSubstepRail } from './discord-substep-rail';
import { DISCORD_SUBSTEPS, substepIndex, useDerivedDiscordSubstep, type DiscordSubstep } from './use-discord-substep';
import { CreateAppScreen } from './create-app-screen';
import { SignInLinksScreen } from './sign-in-links-screen';
import { KeysScreen } from './keys-screen';
import { InviteScreen } from './invite-screen';
import { BotJoinedScreen } from './bot-joined-screen';
import type { SubstepNav } from './substep-screen';

export interface DiscordSetupStepProps {
    onNext: () => void;
    onBack: () => void;
    /** D-9 "Finish later": offered on 4e only (AC-10). */
    onFinishLater: () => void;
}

type ScreenNav = SubstepNav & { onFinishLater: () => void };

const SCREENS: Record<DiscordSubstep, (nav: ScreenNav) => JSX.Element> = {
    create: ({ onNext, onBack }) => <CreateAppScreen onNext={onNext} onBack={onBack} />,
    links: ({ onNext, onBack }) => <SignInLinksScreen onNext={onNext} onBack={onBack} />,
    keys: ({ onNext, onBack }) => <KeysScreen onNext={onNext} onBack={onBack} />,
    invite: ({ onNext, onBack }) => <InviteScreen onNext={onNext} onBack={onBack} />,
    joined: (nav) => <BotJoinedScreen {...nav} />,
};

export function DiscordSetupStep({ onNext, onBack, onFinishLater }: DiscordSetupStepProps) {
    const derived = useDerivedDiscordSubstep();
    const [chosen, setChosen] = useState<DiscordSubstep | null>(null);
    if (derived && chosen === null) setChosen(derived);
    if (!derived) return <div className="py-12 flex justify-center"><LoadingSpinner /></div>;

    const current = chosen ?? derived;
    const index = substepIndex(current);
    const move = (delta: number): void => {
        const next = DISCORD_SUBSTEPS[index + delta];
        if (index + delta < 0) onBack();
        else if (!next) onNext();
        else setChosen(next.key);
    };
    const nav: ScreenNav = { onNext: () => move(1), onBack: () => move(-1), onFinishLater };

    return (
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10" data-testid="discord-setup-step">
            <DiscordSubstepRail current={index} reachable={Math.max(index, substepIndex(derived))} onSelect={setChosen} />
            <div className="min-w-0">{SCREENS[current](nav)}</div>
        </div>
    );
}
