/**
 * ROK-1833 — Valheim Link admin + ingest-response schemas. One parse and one
 * reject case per schema; the issue response is the only shape that carries
 * the raw `rlvl_` token.
 *
 * Runs under the contract workspace's own vitest config
 * (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from "vitest";
import {
  ValheimLinkTokenStatusSchema,
  ValheimLinkTokenListResponseSchema,
  ValheimLinkTokenIssuedSchema,
  ValheimLinkIngestResultSchema,
  ValheimLinkBlobResultSchema,
  ValheimLinkIngestErrorCodeSchema,
  ValheimLinkTokenSchema,
} from "../valheim-link-admin.schema.js";

const SHA = "a".repeat(64);
const TOKEN = `rlvl_${"A".repeat(42)}-`;

const activeStatus = {
  pelicanServerId: 7,
  serverId: "7",
  state: "active",
  tokenHint: "ab1-",
  createdAt: "2026-10-18T12:00:00.000Z",
  rotatedAt: null,
  revokedAt: null,
  lastUsedAt: null,
};

describe("ValheimLinkTokenSchema", () => {
  it("accepts rlvl_ + 43 base64url chars", () => {
    expect(ValheimLinkTokenSchema.safeParse(TOKEN).success).toBe(true);
  });
  it("rejects a short or unprefixed token", () => {
    expect(ValheimLinkTokenSchema.safeParse("rlvl_abc").success).toBe(false);
    expect(ValheimLinkTokenSchema.safeParse("A".repeat(48)).success).toBe(
      false,
    );
  });
});

describe("ValheimLinkTokenStatusSchema", () => {
  it("parses an active row", () => {
    expect(ValheimLinkTokenStatusSchema.safeParse(activeStatus).success).toBe(
      true,
    );
  });
  it("parses a server that never had a token", () => {
    const none = {
      ...activeStatus,
      state: "none",
      tokenHint: null,
      createdAt: null,
    };
    expect(ValheimLinkTokenStatusSchema.safeParse(none).success).toBe(true);
  });
  it("rejects an unknown key (strict — a hash or token must never ride along)", () => {
    const leaked = { ...activeStatus, tokenHash: SHA };
    expect(ValheimLinkTokenStatusSchema.safeParse(leaked).success).toBe(false);
  });
  it("rejects an unknown state", () => {
    const bad = { ...activeStatus, state: "expired" };
    expect(ValheimLinkTokenStatusSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ValheimLinkTokenListResponseSchema", () => {
  it("parses a list", () => {
    const res = ValheimLinkTokenListResponseSchema.safeParse({
      data: [activeStatus],
    });
    expect(res.success).toBe(true);
  });
  it("rejects a list carrying a token", () => {
    const res = ValheimLinkTokenListResponseSchema.safeParse({
      data: [{ ...activeStatus, token: TOKEN }],
    });
    expect(res.success).toBe(false);
  });
});

describe("ValheimLinkTokenIssuedSchema", () => {
  it("parses the show-once issue response", () => {
    const res = ValheimLinkTokenIssuedSchema.safeParse({
      token: TOKEN,
      serverId: "7",
      status: activeStatus,
    });
    expect(res.success).toBe(true);
  });
  it("rejects a malformed token", () => {
    const res = ValheimLinkTokenIssuedSchema.safeParse({
      token: "not-a-token",
      serverId: "7",
      status: activeStatus,
    });
    expect(res.success).toBe(false);
  });
});

describe("ValheimLinkIngestResultSchema", () => {
  it("parses accepted with missing blobs", () => {
    const res = ValheimLinkIngestResultSchema.safeParse({
      status: "accepted",
      missingBlobs: [SHA],
    });
    expect(res.success).toBe(true);
  });
  it("rejects a non-sha256 missing blob", () => {
    const res = ValheimLinkIngestResultSchema.safeParse({
      status: "stale",
      missingBlobs: ["XYZ"],
    });
    expect(res.success).toBe(false);
  });
});

describe("ValheimLinkBlobResultSchema", () => {
  it("parses stored and exists", () => {
    for (const status of ["stored", "exists"]) {
      expect(
        ValheimLinkBlobResultSchema.safeParse({ status, sha256: SHA }).success,
      ).toBe(true);
    }
  });
  it("rejects an unknown status", () => {
    const res = ValheimLinkBlobResultSchema.safeParse({
      status: "pending",
      sha256: SHA,
    });
    expect(res.success).toBe(false);
  });
});

describe("ValheimLinkIngestErrorCodeSchema", () => {
  it("lists every spec error code", () => {
    expect([...ValheimLinkIngestErrorCodeSchema.options].sort()).toEqual(
      [
        "bad_gzip",
        "bad_ihdr",
        "bad_json",
        "bitmap_invalid",
        "blob_ref_mismatch",
        "captured_at_in_future",
        "hash_mismatch",
        "invalid_token",
        "kind_mismatch",
        "not_png",
        "payload_too_large",
        "png_too_large",
        "rate_limited",
        "schema_invalid",
        "server_mismatch",
        "server_not_valheim",
        "unknown_kind",
        "unsupported_media",
      ].sort(),
    );
  });
  it("rejects an unknown code", () => {
    expect(ValheimLinkIngestErrorCodeSchema.safeParse("teapot").success).toBe(
      false,
    );
  });
});
