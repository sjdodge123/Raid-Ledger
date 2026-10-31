import { Button } from '../../../ui/button';
import { buttonClass } from '../../../ui/button-classes';
import { SubstepFooter, SubstepNote, SubstepScreen, type SubstepNav } from './substep-screen';

const PORTAL_URL = 'https://discord.com/developers/applications';

function Instruction({ n, children }: { n: number; children: React.ReactNode }) {
    return (
        <li className="flex gap-3">
            <span className="w-6 h-6 shrink-0 rounded-full border border-edge flex items-center justify-center text-xs font-semibold text-muted" aria-hidden="true">{n}</span>
            <div className="text-sm text-secondary space-y-2">{children}</div>
        </li>
    );
}

/** 4a — "Create your Discord application" (approved sheet Discord1). */
export function CreateAppScreen({ onNext, onBack }: SubstepNav) {
    return (
        <SubstepScreen step={1} title="Create your Discord application"
            lead="Discord has to know about your Raid Ledger before anyone can sign in with it. One application covers both sign-in and the bot."
            footer={<SubstepFooter onBack={onBack}><Button onClick={onNext}>I've created it</Button></SubstepFooter>}>
            <ol className="space-y-4">
                <Instruction n={1}>
                    <p><strong className="text-foreground">Open the Discord Developer Portal.</strong> Sign in with the Discord account that runs your server.</p>
                    <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'secondary' })}>Open Developer Portal</a>
                </Instruction>
                <Instruction n={2}>
                    <p><strong className="text-foreground">Click New Application.</strong> Name it after your community. Members see this name when they sign in, and your bot starts out with it too.</p>
                </Instruction>
                <Instruction n={3}>
                    <p><strong className="text-foreground">Keep that tab open.</strong> The next screens tell you exactly what to copy from it.</p>
                </Instruction>
            </ol>
            <SubstepNote>Use a Discord account you'll keep. Whoever owns the application can reset your bot's token.</SubstepNote>
        </SubstepScreen>
    );
}
