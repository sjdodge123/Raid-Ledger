/**
 * Contract tests for the Calendar Sync foundation shapes (ROK-1591).
 *
 * Pins the three rules the api and web lanes rely on: the 2026-10-08 ruling
 * removed every `includeTentative` toggle (rejected, not stripped); admin
 * client secrets never appear in a read shape; and the PUT never requires a
 * secret, with an empty string meaning "clear".
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
    AppleConnectInputSchema,
    CalendarConnectionSchema,
    CalendarFeedSchema,
    CalendarOAuthErrorCodeSchema,
    CalendarOAuthIntentSchema,
    CalendarSyncErrorCodeSchema,
    CalendarsOverviewSchema,
    UpdateCalendarConnectionSchema,
    UpdateCalendarReadSettingsSchema,
} from '../calendar-sync.schema.js';
import {
    AdminCalendarSyncSettingsSchema,
    UpdateAdminCalendarSyncSettingsSchema,
} from '../calendar-sync-admin.schema.js';

/** Issue code + path (+ unrecognised keys), or [] when the input parsed. */
function issuesOf(schema: z.ZodType, input: unknown) {
    const result = schema.safeParse(input);
    if (result.success) return [];
    return result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        ...('keys' in issue ? { keys: issue.keys } : {}),
    }));
}

const strayTentative = (path: PropertyKey[]) => [
    { code: 'unrecognized_keys', path, keys: ['includeTentative'] },
];

const connection = {
    id: 7,
    provider: 'google',
    accountLabel: 'raider@example.com',
    status: 'active',
    lastSyncedAt: '2026-10-08T12:00:00.000Z',
    errorCode: null,
    read: { enabled: false, calendarIds: [] },
    write: { enabled: true, target: 'dedicated' },
};

const switchOffOverview = {
    enabled: false,
    providers: {
        google: { available: false },
        microsoft: { available: false },
        apple: { available: false },
    },
    connections: [],
    readSettings: { mode: 'both', lookAheadWeeks: 4 },
    feed: null,
};

describe('AppleConnectInputSchema — app-specific password', () => {
    const email = 'raider@icloud.com';

    it.each(['abcd-efgh-ijkl-mnop', 'ABCD-efgh-IJKL-mnop'])(
        'accepts %s',
        (appPassword) => {
            expect(issuesOf(AppleConnectInputSchema, { email, appPassword })).toEqual([]);
        },
    );

    it.each([
        'abcdefghijklmnop',
        'abcd-efgh-ijkl',
        'abc1-efgh-ijkl-mnop',
        'abcd-efgh-ijkl-mnop-qrst',
        ' abcd-efgh-ijkl-mnop',
        'abcd_efgh_ijkl_mnop',
    ])('rejects %j on appPassword', (appPassword) => {
        expect(issuesOf(AppleConnectInputSchema, { email, appPassword })).toEqual([
            { code: 'invalid_format', path: ['appPassword'] },
        ]);
    });

    it('rejects an unknown key', () => {
        const input = { email, appPassword: 'abcd-efgh-ijkl-mnop', password: 'x' };
        expect(issuesOf(AppleConnectInputSchema, input)).toEqual([
            { code: 'unrecognized_keys', path: [], keys: ['password'] },
        ]);
    });
});

describe('includeTentative is gone (D2, ruling 2026-10-08)', () => {
    it('accepts a connection without it', () => {
        expect(issuesOf(CalendarConnectionSchema, connection)).toEqual([]);
    });

    it('rejects it on a connection write block', () => {
        const input = { ...connection, write: { ...connection.write, includeTentative: true } };
        expect(issuesOf(CalendarConnectionSchema, input)).toEqual(strayTentative(['write']));
    });

    it('rejects it on the PATCH input instead of stripping it', () => {
        const input = { write: { includeTentative: false } };
        expect(issuesOf(UpdateCalendarConnectionSchema, input)).toEqual(
            strayTentative(['write']),
        );
    });

    it('still accepts a partial PATCH write block', () => {
        const input = { write: { target: 'primary' } };
        expect(UpdateCalendarConnectionSchema.parse(input)).toEqual(input);
    });

    it('rejects it on the ICS feed', () => {
        const input = { url: 'https://raid.example/cal/u/t.ics', includeTentative: true };
        expect(issuesOf(CalendarFeedSchema, input)).toEqual(strayTentative([]));
    });
});

describe('UpdateAdminCalendarSyncSettingsSchema — secrets optional', () => {
    it.each([
        {},
        { enabled: true },
        { google: { clientId: 'google-client-id' } },
        { microsoft: { clientId: 'ms-client-id' }, enabled: false },
    ])('parses %j without any secret', (input) => {
        expect(UpdateAdminCalendarSyncSettingsSchema.parse(input)).toEqual(input);
    });

    it('keeps an empty-string secret (the "clear it" signal)', () => {
        const input = { google: { clientSecret: '' } };
        expect(UpdateAdminCalendarSyncSettingsSchema.parse(input)).toEqual(input);
    });

    it('rejects an unknown provider key', () => {
        const input = { apple: { clientId: 'x' } };
        expect(issuesOf(UpdateAdminCalendarSyncSettingsSchema, input)).toEqual([
            { code: 'unrecognized_keys', path: [], keys: ['apple'] },
        ]);
    });
});

describe('AdminCalendarSyncSettingsSchema — secrets never leave the server', () => {
    const settings = {
        enabled: true,
        google: { clientId: 'google-client-id', hasSecret: true },
        microsoft: { clientId: null, hasSecret: false },
        redirectUris: {
            google: 'https://slot-1.example.net/api/calendar-sync/oauth/google/callback',
            microsoft: 'https://slot-1.example.net/api/calendar-sync/oauth/microsoft/callback',
        },
    };

    it('accepts hasSecret + redirectUris', () => {
        expect(issuesOf(AdminCalendarSyncSettingsSchema, settings)).toEqual([]);
    });

    it('rejects a clientSecret value in the read shape', () => {
        const input = {
            ...settings,
            google: { ...settings.google, clientSecret: 'leaked' },
        };
        expect(issuesOf(AdminCalendarSyncSettingsSchema, input)).toEqual([
            { code: 'unrecognized_keys', path: ['google'], keys: ['clientSecret'] },
        ]);
    });
});

describe('CalendarsOverviewSchema', () => {
    it('parses the kill-switch-off shape', () => {
        expect(CalendarsOverviewSchema.parse(switchOffOverview)).toEqual(switchOffOverview);
    });

    it('requires every provider key (the record is exhaustive)', () => {
        const { apple: _apple, ...providers } = switchOffOverview.providers;
        const input = { ...switchOffOverview, providers };
        expect(issuesOf(CalendarsOverviewSchema, input).map(({ path }) => path)).toEqual([
            ['providers', 'apple'],
        ]);
    });

    it('pins the look-ahead at 4 weeks', () => {
        const input = {
            ...switchOffOverview,
            readSettings: { mode: 'both', lookAheadWeeks: 8 },
        };
        expect(issuesOf(CalendarsOverviewSchema, input)).toEqual([
            { code: 'invalid_value', path: ['readSettings', 'lookAheadWeeks'] },
        ]);
    });
});

describe('CalendarOAuthIntentSchema (ROK-1596 D8, ROK-1593 §3.2)', () => {
    it('accepts connect, primary and read', () => {
        expect(CalendarOAuthIntentSchema.options).toEqual(['connect', 'primary', 'read']);
    });

    it('parses intent=read', () => {
        expect(CalendarOAuthIntentSchema.parse('read')).toBe('read');
    });

    it('rejects anything else', () => {
        for (const v of ['write', 'READ', '', 'PRIMARY', undefined]) {
            expect(CalendarOAuthIntentSchema.safeParse(v).success).toBe(false);
        }
    });
});

describe('CalendarOAuthErrorCodeSchema (ROK-1593 §3.2)', () => {
    it('accepts read_scopes', () => {
        expect(CalendarOAuthErrorCodeSchema.parse('read_scopes')).toBe('read_scopes');
    });

    it('keeps every pre-1593 code', () => {
        for (const code of ['state', 'denied', 'exchange', 'scopes', 'disabled', 'unavailable']) {
            expect(CalendarOAuthErrorCodeSchema.parse(code)).toBe(code);
        }
    });
});

describe('CalendarSyncErrorCodeSchema (ROK-1593 §3.6)', () => {
    it('is the closed set the server emits', () => {
        expect(CalendarSyncErrorCodeSchema.options).toEqual([
            'auth',
            'read_scopes',
            'rate_limited',
            'provider_error',
            'read_disabled',
        ]);
    });

    it('rejects an unknown code', () => {
        expect(CalendarSyncErrorCodeSchema.safeParse('scopes').success).toBe(false);
    });
});

describe('UpdateCalendarReadSettingsSchema (ROK-1593 PUT settings)', () => {
    it('accepts a valid body', () => {
        const body = { mode: 'both', lookAheadWeeks: 4 };
        expect(UpdateCalendarReadSettingsSchema.safeParse(body).success).toBe(true);
    });

    it('accepts an omitted lookAheadWeeks', () => {
        const result = UpdateCalendarReadSettingsSchema.safeParse({ mode: 'both' });
        expect(result.success).toBe(true);
    });

    it('rejects a stray key', () => {
        const issues = issuesOf(UpdateCalendarReadSettingsSchema, {
            mode: 'both',
            extra: 1,
        });
        expect(issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    });

    it('rejects a look-ahead other than the fixed window', () => {
        const result = UpdateCalendarReadSettingsSchema.safeParse({
            mode: 'both',
            lookAheadWeeks: 8,
        });
        expect(result.success).toBe(false);
    });
});

describe('CalendarConnectionSchema.readAccess (ROK-1593 §3.6)', () => {
    it('still parses a pre-1593 connection without readAccess', () => {
        expect(CalendarConnectionSchema.parse(connection)).toEqual(connection);
    });

    it.each(['granted', 'missing'])('accepts readAccess=%s', (readAccess) => {
        const input = { ...connection, readAccess };
        expect(CalendarConnectionSchema.parse(input)).toEqual(input);
    });

    it('rejects an unknown readAccess value', () => {
        const input = { ...connection, readAccess: 'partial' };
        expect(issuesOf(CalendarConnectionSchema, input)).toEqual([
            { code: 'invalid_value', path: ['readAccess'] },
        ]);
    });

    it('rejects readAccess inside the read block (PATCH reuses it)', () => {
        const input = { read: { readAccess: 'granted' } };
        expect(issuesOf(UpdateCalendarConnectionSchema, input)).toEqual([
            { code: 'unrecognized_keys', path: ['read'], keys: ['readAccess'] },
        ]);
    });

    it('still rejects a stray top-level key on the connection', () => {
        const input = { ...connection, readAccess: 'granted', title: 'Dentist' };
        expect(issuesOf(CalendarConnectionSchema, input)).toEqual([
            { code: 'unrecognized_keys', path: [], keys: ['title'] },
        ]);
    });
});
