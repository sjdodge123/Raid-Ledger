/**
 * ROK-2371 — Sign in with Google contract shapes. One parse and one reject
 * case per schema; the pending view is `.strict()` so a leaked subject or
 * email fails the parse.
 *
 * Runs under the contract workspace's own vitest config
 * (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from "vitest";
import {
  SigninMethodsSchema,
  PendingIdentityViewSchema,
} from "../auth-identities.schema.js";
import { LoginMethodSchema } from "../system.schema.js";
import {
  AdminCalendarSyncSettingsSchema,
  UpdateAdminCalendarSyncSettingsSchema,
} from "../calendar-sync-admin.schema.js";

const ISO = "2026-11-26T12:00:00.000Z";

describe("SigninMethodsSchema", () => {
  it("parses a Google-linked user with no Discord or password", () => {
    const parsed = SigninMethodsSchema.parse({
      discord: false,
      google: { email: "a@example.com", linkedAt: ISO },
      password: false,
    });
    expect(parsed.google?.linkedAt).toBe(ISO);
  });

  it("accepts google: null and a null display email", () => {
    expect(
      SigninMethodsSchema.safeParse({ discord: true, google: null, password: false })
        .success,
    ).toBe(true);
    expect(
      SigninMethodsSchema.safeParse({
        discord: false,
        google: { email: null, linkedAt: ISO },
        password: false,
      }).success,
    ).toBe(true);
  });

  it("rejects a google identity carrying its subject", () => {
    const result = SigninMethodsSchema.safeParse({
      discord: false,
      google: { email: null, linkedAt: ISO, subject: "1234" },
      password: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("PendingIdentityViewSchema", () => {
  it("parses a pending Google identity", () => {
    const view = { provider: "google", displayName: "Jo", otherMethod: "discord" };
    expect(PendingIdentityViewSchema.parse(view)).toEqual(view);
  });

  it("rejects an email or an unknown provider", () => {
    const base = { provider: "google", displayName: "Jo", otherMethod: "discord" };
    expect(
      PendingIdentityViewSchema.safeParse({ ...base, email: "a@example.com" }).success,
    ).toBe(false);
    expect(
      PendingIdentityViewSchema.safeParse({ ...base, provider: "steam" }).success,
    ).toBe(false);
  });
});

describe("LoginMethodSchema.placement", () => {
  const google = {
    key: "google",
    label: "Sign in with Google",
    icon: "google",
    loginPath: "/auth/google",
  };

  it("is optional and accepts primary / alternate", () => {
    expect(LoginMethodSchema.safeParse(google).success).toBe(true);
    expect(LoginMethodSchema.parse({ ...google, placement: "primary" }).placement).toBe(
      "primary",
    );
    expect(LoginMethodSchema.safeParse({ ...google, placement: "alternate" }).success).toBe(
      true,
    );
  });

  it("rejects an unknown placement", () => {
    expect(LoginMethodSchema.safeParse({ ...google, placement: "hidden" }).success).toBe(
      false,
    );
  });
});

describe("calendar-sync admin DTO — Google sign-in fields", () => {
  const read = {
    enabled: true,
    google: { clientId: "id", hasSecret: true },
    microsoft: { clientId: null, hasSecret: false },
    redirectUris: {
      google: "https://slot-1.gamernight.net/api/calendar/google/callback",
      microsoft: "https://slot-1.gamernight.net/api/calendar/microsoft/callback",
    },
  };

  it("still parses a payload without the new fields", () => {
    expect(AdminCalendarSyncSettingsSchema.safeParse(read).success).toBe(true);
  });

  it("parses googleSigninEnabled and the sign-in redirect URIs", () => {
    const parsed = AdminCalendarSyncSettingsSchema.parse({
      ...read,
      googleSigninEnabled: true,
      redirectUris: {
        ...read.redirectUris,
        googleSignin: [
          "https://slot-1.gamernight.net/api/auth/google/callback",
          "https://slot-1.gamernight.net/api/auth/google/link/callback",
        ],
      },
    });
    expect(parsed.redirectUris.googleSignin).toHaveLength(2);
  });

  it("rejects a non-URL sign-in redirect URI", () => {
    const result = AdminCalendarSyncSettingsSchema.safeParse({
      ...read,
      redirectUris: { ...read.redirectUris, googleSignin: ["not a url"] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts googleSigninEnabled on the update body", () => {
    expect(
      UpdateAdminCalendarSyncSettingsSchema.safeParse({ googleSigninEnabled: true })
        .success,
    ).toBe(true);
    expect(
      UpdateAdminCalendarSyncSettingsSchema.safeParse({ googleSigninEnabled: "yes" })
        .success,
    ).toBe(false);
  });
});
