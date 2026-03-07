import type { JSX } from 'react';
import type { StepDef } from './onboarding-types';
import { ConnectStepLabel, CharacterStepLabel, StepDot } from './onboarding-step-labels';

interface OnboardingBreadcrumbsProps {
    steps: StepDef[];
    currentStep: number;
    setCurrentStep: (index: number) => void;
    removeCharacterStep: (gameId: number) => void;
    user: { avatar: string | null; displayName: string | null; username: string; discordId: string } | null;
}

/** Breadcrumb navigation for onboarding wizard steps */
export function OnboardingBreadcrumbs({
    steps, currentStep, setCurrentStep, removeCharacterStep, user,
}: OnboardingBreadcrumbsProps): JSX.Element {
    return (
        <div className="flex-shrink-0 px-4 py-2 flex items-center justify-center gap-0.5">
            {steps.map((step, index) => (
                <BreadcrumbStep
                    key={step.key}
                    step={step}
                    index={index}
                    currentStep={currentStep}
                    setCurrentStep={setCurrentStep}
                    removeCharacterStep={removeCharacterStep}
                    user={user}
                />
            ))}
        </div>
    );
}

/** Resolves the label content for a breadcrumb step */
function resolveStepLabel(step: StepDef, isCurrent: boolean, isVisited: boolean,
    user: { avatar: string | null; displayName: string | null; username: string; discordId: string } | null,
): JSX.Element {
    if (step.key === 'connect') {
        return <ConnectStepLabel user={user} isCurrent={isCurrent} isVisited={isVisited} />;
    }
    if (step.registryGame != null && step.charIndex != null) {
        return <CharacterStepLabel game={step.registryGame} charIndex={step.charIndex} isCurrent={isCurrent} isVisited={isVisited} />;
    }
    return (<><StepDot isCurrent={isCurrent} isVisited={isVisited} />{step.label}</>);
}

/** Returns the button className for a breadcrumb step */
function breadcrumbButtonClass(isCurrent: boolean, isVisited: boolean): string {
    const base = 'group relative flex items-center justify-center rounded-full text-xs font-medium transition-all duration-300 ease-in-out min-w-[44px] min-h-[44px]';
    if (isCurrent) return `${base} bg-emerald-600 text-white px-2.5 py-1.5`;
    if (isVisited) return `${base} text-emerald-400 hover:bg-emerald-500/10 cursor-pointer px-1.5 py-1.5`;
    return `${base} text-dim hover:bg-edge/20 cursor-pointer px-1.5 py-1.5`;
}

/** Single breadcrumb step button */
function BreadcrumbStep({ step, index, currentStep, setCurrentStep, removeCharacterStep, user }: {
    step: StepDef; index: number; currentStep: number;
    setCurrentStep: (index: number) => void; removeCharacterStep: (gameId: number) => void;
    user: { avatar: string | null; displayName: string | null; username: string; discordId: string } | null;
}): JSX.Element {
    const isExpanded = Math.abs(index - currentStep) <= 1;
    const isCurrent = index === currentStep;
    const isVisited = index < currentStep;
    const labelContent = resolveStepLabel(step, isCurrent, isVisited, user);
    const dotColor = isVisited || isCurrent ? 'bg-emerald-400' : 'bg-edge/50';

    return (
        <button key={step.key} type="button" onClick={() => setCurrentStep(index)} className={breadcrumbButtonClass(isCurrent, isVisited)}>
            <span className={`rounded-full flex-shrink-0 transition-all duration-300 ease-in-out ${dotColor} ${isExpanded ? 'w-0 h-0 opacity-0' : 'w-3 h-3 opacity-100'}`} />
            <ExpandedLabel isExpanded={isExpanded} labelContent={labelContent} step={step} removeCharacterStep={removeCharacterStep} />
            {!isExpanded && <HoverLabel isVisited={isVisited} labelContent={labelContent} />}
        </button>
    );
}

/** In-flow expanded label for nearby steps */
function ExpandedLabel({ isExpanded, labelContent, step, removeCharacterStep }: {
    isExpanded: boolean;
    labelContent: JSX.Element;
    step: StepDef;
    removeCharacterStep: (gameId: number) => void;
}): JSX.Element {
    return (
        <span className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap
            transition-all duration-300 ease-in-out
            ${isExpanded ? 'max-w-[12rem] opacity-100' : 'max-w-0 opacity-0'}`}>
            {labelContent}
            {step.charIndex != null && step.charIndex > 0 && step.registryGame && (
                <RemoveCharButton gameId={step.registryGame.id} removeCharacterStep={removeCharacterStep} />
            )}
        </span>
    );
}

/** Hover overlay label for collapsed steps */
function HoverLabel({ isVisited, labelContent }: {
    isVisited: boolean;
    labelContent: JSX.Element;
}): JSX.Element {
    return (
        <span className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5
            text-xs font-medium opacity-0 scale-90 pointer-events-none
            group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto
            transition-all duration-200 ease-out
            ${isVisited
                ? 'bg-surface text-emerald-400 shadow-lg shadow-black/30'
                : 'bg-surface text-dim shadow-lg shadow-black/30'
            }`}>
            {labelContent}
        </span>
    );
}

/** Remove character step button (X icon) */
function RemoveCharButton({ gameId, removeCharacterStep }: {
    gameId: number;
    removeCharacterStep: (gameId: number) => void;
}): JSX.Element {
    return (
        <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); removeCharacterStep(gameId); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeCharacterStep(gameId); } }}
            className="ml-0.5 w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-500/30 text-current opacity-60 hover:opacity-100 transition-all flex-shrink-0"
            title="Remove this character slot"
        >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
        </span>
    );
}
