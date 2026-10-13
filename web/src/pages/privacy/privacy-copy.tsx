/**
 * ROK-1778: the `/privacy` page copy, as data. Approved by the operator
 * 2026-10-13 (spec §2 + §6) — change the wording here only with a new ruling,
 * and bump `PRIVACY_LAST_UPDATED` when you do.
 *
 * `[CFG:*]` parts of the approved draft are parameters: the community name,
 * the optional contact email, and the features a section depends on.
 */
import type { ReactNode } from 'react';
import { ExtLink, Lead } from './privacy-copy-parts';

export const PRIVACY_LAST_UPDATED = '13 October 2026';
export const COMMUNITY_FALLBACK = 'this community';
export const GOOGLE_USER_DATA_POLICY_URL = 'https://developers.google.com/terms/api-services-user-data-policy';

/** Features whose disclosure only applies while they are on. */
export type PrivacyFeature = 'calendar' | 'ai';
export type PrivacyFeatures = Record<PrivacyFeature, boolean>;

export interface PrivacyBlock {
    key: string;
    requires?: PrivacyFeature;
    content: ReactNode;
}

export interface PrivacySection {
    id: string;
    heading: string;
    requires?: PrivacyFeature;
    paragraphs?: PrivacyBlock[];
    bullets?: PrivacyBlock[];
}

export interface PrivacyContext {
    community: string;
    contactEmail: string | null;
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function whoRunsSection({ community }: PrivacyContext): PrivacySection {
    return {
        id: 'who-runs',
        heading: 'Who runs this site',
        paragraphs: [{
            key: 'operator',
            content: <>
                This site runs Raid Ledger, free software that {community} hosts for its own members.{' '}
                {capitalize(community)}&apos;s admins run it and are responsible for your data here. The Raid
                Ledger project does not run this site and cannot see your account.
            </>,
        }],
    };
}

function whatWeKeepSection(): PrivacySection {
    return {
        id: 'what-we-keep',
        heading: 'What we keep about you',
        bullets: [
            { key: 'discord', content: 'Your Discord account id, username and avatar, from signing in with Discord. We ask Discord only for your basic profile, not your email address.' },
            { key: 'added', content: 'What you add: your display name, characters, game time and away days, event sign-ups, game interests and preferences.' },
            { key: 'activity', content: 'Activity the community uses to plan: voice-channel attendance at events, and which games members play together.' },
            { key: 'sessions', content: 'Sign-in sessions, so you stay logged in.' },
        ],
    };
}

const LIMITED_USE: ReactNode = <>
    <Lead>Limited Use.</Lead> This site&apos;s use and transfer to any other app of information received from
    Google APIs will adhere to the{' '}
    <ExtLink href={GOOGLE_USER_DATA_POLICY_URL}>Google API Services User Data Policy</ExtLink>, including the
    Limited Use requirements. We use Google data only to show your availability and keep your calendar up to
    date on this site. We don&apos;t sell it, use it for ads, or use it to train AI models, and people read it
    only when you ask us to, for security, or when the law requires.
</>;

function googleCalendarSection(): PrivacySection {
    return {
        id: 'google-calendar',
        heading: 'Google Calendar (only if you connect it)',
        requires: 'calendar',
        bullets: [
            { key: 'ask', content: <><Lead>What we ask Google for.</Lead> Your Google email (to show which account is connected) and permission to manage a &quot;Raid Ledger&quot; calendar this site creates for you. If you choose to, you can also let us add events to your main calendar and see when you are busy.</> },
            { key: 'read', content: <><Lead>What we read.</Lead> If you turn on busy-time sync, we read only <em>when</em> events on the calendars you pick start and end, and whether they show you as busy. We never read event titles, descriptions, locations or guest lists. We see your calendar names only to show you the list, and we don&apos;t save them.</> },
            { key: 'keep', content: <><Lead>What we keep.</Lead> Your busy times, the away days we work out from them, the calendars you picked, your Google email, and your Google sign-in token, stored encrypted.</> },
            { key: 'write', content: <><Lead>What we write.</Lead> For events you sign up to, we add a copy to your Raid Ledger calendar (or your main calendar if you choose): the event title, its time, and a link back to this site.</> },
            { key: 'disconnect', content: <><Lead>Disconnecting.</Lead> When you disconnect, we delete your busy times and synced away days straight away. Then we remove the copies we added, delete the Raid Ledger calendar, delete your Google token and ask Google to cancel our access. You can also cancel access at any time from your Google Account&apos;s security settings.</> },
            { key: 'limited-use', content: LIMITED_USE },
        ],
    };
}

function whoElseSection(): PrivacySection {
    return {
        id: 'who-else',
        heading: 'Who else gets data',
        bullets: [
            { key: 'discord', content: <><Lead>Discord</Lead> shows event posts and messages that mention members.</> },
            { key: 'google', requires: 'calendar', content: <><Lead>Google</Lead>: calendar sync, as above.</> },
            { key: 'errors', content: <><Lead>Error reports.</Lead> When something breaks, an error report (and on the web app, a recording of the page with on-screen text masked) is sent to the Raid Ledger project&apos;s error tracker, Sentry, so the developers can fix it. Passwords, tokens and calendar ids are removed first.</> },
            { key: 'ai', requires: 'ai', content: <><Lead>AI suggestions.</Lead> If the admins turn on AI features, members&apos; usernames and gaming stats (not calendar data) are sent to the AI provider they chose to suggest games.</> },
            { key: 'games', content: 'Game databases (IGDB, Steam, IsThereAnyDeal, Blizzard) are asked about games and characters. If you link Steam, your Steam id is used to read your game library.' },
        ],
    };
}

function retentionSections(): PrivacySection[] {
    return [
        {
            id: 'retention',
            heading: 'How long we keep it',
            paragraphs: [{ key: 'retention', content: "We keep your data while you have an account. If you leave the community's Discord server, your account is switched off but not deleted. Deleting your account (Profile → Account) removes your data. Copies in backups are gone within 30 days." }],
        },
        {
            id: 'cookies',
            heading: 'Cookies',
            paragraphs: [{ key: 'cookies', content: 'We use only what sign-in needs: a secure sign-in cookie, plus browser storage for your login and display settings. No advertising or analytics cookies.' }],
        },
    ];
}

function contactSection({ community, contactEmail }: PrivacyContext): PrivacySection {
    const discord = <>ask an admin in {community}&apos;s Discord server.</>;
    const content = contactEmail
        ? <>Questions or deletion requests:{' '}
            <a href={`mailto:${contactEmail}`} className="underline hover:text-foreground">{contactEmail}</a>, or {discord}</>
        : <>Questions or deletion requests: {discord}</>;
    return { id: 'contact', heading: 'Contact', paragraphs: [{ key: 'contact', content }] };
}

function isShown(item: { requires?: PrivacyFeature }, features: PrivacyFeatures): boolean {
    return item.requires === undefined || features[item.requires];
}

function filterSection(section: PrivacySection, features: PrivacyFeatures): PrivacySection {
    return {
        ...section,
        ...(section.paragraphs ? { paragraphs: section.paragraphs.filter((b) => isShown(b, features)) } : {}),
        ...(section.bullets ? { bullets: section.bullets.filter((b) => isShown(b, features)) } : {}),
    };
}

/** The policy, in order, with every section/bullet whose feature is off dropped. */
export function buildPrivacySections(ctx: PrivacyContext, features: PrivacyFeatures): PrivacySection[] {
    const all = [
        whoRunsSection(ctx), whatWeKeepSection(), googleCalendarSection(), whoElseSection(),
        ...retentionSections(), contactSection(ctx),
    ];
    return all.filter((s) => isShown(s, features)).map((s) => filterSection(s, features));
}
