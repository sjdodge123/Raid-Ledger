/**
 * ROK-2263 — backup-export token shapes. The pattern accepts a generated
 * sample and refuses the other token families; the list DTO is `.strict()`
 * so neither the raw token nor its hash can ride along.
 *
 * Runs under the contract workspace's own vitest config.
 */
import { describe, it, expect } from "vitest";
import {
  BACKUP_EXPORT_TOKEN_PATTERN,
  BackupExportTokenSchema,
  BackupExportTokenListResponseSchema,
  MintBackupExportTokenRequestSchema,
  MintBackupExportTokenResponseSchema,
} from "../backup-export-token.schema.js";

const TOKEN = `rlbx_${"A".repeat(42)}-`;
const ISO = "2026-11-19T02:00:00.000Z";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.c2lnbmF0dXJlc2lnbmF0dXJlc2ln";

const item = {
  id: 1,
  label: "Laptop clone",
  tokenHint: "AAA-",
  createdBy: { id: 7, username: "admin" },
  createdAt: ISO,
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
};

describe("BACKUP_EXPORT_TOKEN_PATTERN", () => {
  it("accepts an rlbx_ token of 43 base64url chars", () => {
    expect(BACKUP_EXPORT_TOKEN_PATTERN.test(TOKEN)).toBe(true);
  });

  it.each([
    ["rlcd_ device token", `rlcd_${"A".repeat(43)}`],
    ["rlvl_ valheim token", `rlvl_${"A".repeat(43)}`],
    ["a session JWT", JWT],
    ["a short rlbx_ token", `rlbx_${"A".repeat(42)}`],
    ["a non-base64url char", `rlbx_${"A".repeat(42)}+`],
  ])("rejects %s", (_name, value) => {
    expect(BACKUP_EXPORT_TOKEN_PATTERN.test(value)).toBe(false);
  });
});

describe("BackupExportTokenSchema", () => {
  it("parses a list item", () => {
    expect(BackupExportTokenSchema.parse(item)).toEqual(item);
  });

  it.each(["token", "tokenHash"])("refuses an extra %s key", (key) => {
    const leaked = { ...item, [key]: TOKEN };
    expect(BackupExportTokenSchema.safeParse(leaked).success).toBe(false);
    const list = { tokens: [leaked] };
    expect(BackupExportTokenListResponseSchema.safeParse(list).success).toBe(
      false,
    );
  });
});

describe("MintBackupExportTokenRequestSchema", () => {
  it("trims the label and accepts each expiry choice", () => {
    for (const expiresInDays of [30, 90, 365, null]) {
      const parsed = MintBackupExportTokenRequestSchema.parse({
        label: "  CI box  ",
        expiresInDays,
      });
      expect(parsed).toEqual({ label: "CI box", expiresInDays });
    }
  });

  it.each([
    ["an empty label", { label: "   ", expiresInDays: 90 }],
    ["a 61-char label", { label: "x".repeat(61), expiresInDays: 90 }],
    ["an unlisted expiry", { label: "ok", expiresInDays: 7 }],
    ["a missing expiry", { label: "ok" }],
  ])("rejects %s", (_name, body) => {
    expect(MintBackupExportTokenRequestSchema.safeParse(body).success).toBe(
      false,
    );
  });
});

describe("MintBackupExportTokenResponseSchema", () => {
  it("carries the raw token once alongside the item", () => {
    const body = { token: TOKEN, item };
    expect(MintBackupExportTokenResponseSchema.parse(body)).toEqual(body);
  });

  it("refuses a token of another family", () => {
    const body = { token: `rlcd_${"A".repeat(43)}`, item };
    expect(MintBackupExportTokenResponseSchema.safeParse(body).success).toBe(
      false,
    );
  });
});
