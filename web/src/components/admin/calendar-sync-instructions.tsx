/**
 * Admin → Integrations → Calendar Sync: step-by-step Google setup guide.
 *
 * Hand-holding copy with a direct Google Cloud Console link per step (the
 * console opens each page on the last project the admin selected). Only
 * Google resolves today; Microsoft (ROK-1597) has fields but no provider yet.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const CONSOLE = 'https://console.cloud.google.com';

const GOOGLE_SETUP_LINKS = {
    createProject: `${CONSOLE}/projectcreate`,
    calendarApi: `${CONSOLE}/apis/library/calendar-json.googleapis.com`,
    authOverview: `${CONSOLE}/auth/overview`,
    audience: `${CONSOLE}/auth/audience`,
    createClient: `${CONSOLE}/auth/clients/create`,
} as const;

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            {children}
        </a>
    );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
    return (
        <li>
            <strong className="text-foreground">{title}</strong> {children}
        </li>
    );
}

function GoogleProjectSteps() {
    return (
        <>
            <Step title="Create a Google Cloud project.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.createProject}>Create a project</ExtLink>, name
                it &quot;Raid Ledger&quot; and click <strong>Create</strong>. Already have one? Pick it
                in the project menu at the top of the page instead.
            </Step>
            <Step title="Turn on the Google Calendar API.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.calendarApi}>Google Calendar API</ExtLink> and
                click <strong>Enable</strong>.
            </Step>
            <Step title="Set up the Google sign-in screen.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.authOverview}>Google Auth Platform</ExtLink> and
                click <strong>Get started</strong>. Enter &quot;Raid Ledger&quot; as the app name and your
                email where it asks, choose <strong>External</strong>, agree, and click <strong>Create</strong>.
            </Step>
            <Step title="Add the people who can connect.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.audience}>Audience</ExtLink>, click{' '}
                <strong>Add users</strong> under Test users, and enter the Google email of every member
                who will connect a calendar, yourself included (up to 100).
            </Step>
        </>
    );
}

function GoogleClientSteps() {
    return (
        <>
            <Step title="Create the OAuth client.">
                Open <ExtLink href={GOOGLE_SETUP_LINKS.createClient}>Create OAuth client</ExtLink>. Set
                Application type to <strong>Web application</strong>. Under Authorized redirect URIs click{' '}
                <strong>Add URI</strong>, paste the <strong>Google redirect URI</strong> shown below (click
                it to copy), then click <strong>Create</strong>.
            </Step>
            <Step title="Paste the keys here.">
                Google shows a <strong>Client ID</strong> and a <strong>Client secret</strong>. Copy each
                one into the Google fields below.
            </Step>
            <Step title="Turn it on.">
                Switch on <strong>Enable Calendar Sync</strong> above and click{' '}
                <strong>Save Configuration</strong>. Members then connect from{' '}
                <Link to="/profile/gaming/calendars" className="underline hover:text-foreground">
                    Profile → Gaming → Calendars
                </Link>.
            </Step>
        </>
    );
}

export function CalendarSyncInstructions() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 space-y-3" data-testid="calendar-sync-instructions">
            <div>
                <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
                <p className="text-xs text-muted mt-1">
                    About 10 minutes with any Google account. Only Google works today, so leave the
                    Microsoft fields empty.
                </p>
            </div>
            <ol className="text-sm text-secondary space-y-2 list-decimal list-inside">
                <GoogleProjectSteps />
                <GoogleClientSteps />
            </ol>
            <p className="text-xs text-muted">
                <strong className="text-secondary">Good to know:</strong> while the Google app is in Testing,
                only the people added in step 4 can connect, and Google asks them to reconnect every 7 days.
                To lift both limits, click <strong>Publish app</strong> on the Audience page. Google may ask
                you to verify the app first, because it writes to members&apos; calendars.
            </p>
        </div>
    );
}
