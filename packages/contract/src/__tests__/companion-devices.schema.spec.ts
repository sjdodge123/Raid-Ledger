/**
 * ROK-1955 — companion device link (RFC 8628 device grant) + Devices API
 * shapes. One parse and one reject case per schema; the poll success is the
 * only shape that carries the raw `rlcd_` token, and the device DTO is
 * `.strict()` so a hash can never pass (T-UNIT-6).
 *
 * Runs under the contract workspace's own vitest config
 * (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from "vitest";
import {
  COMPANION_DEVICE_TOKEN_PATTERN,
  COMPANION_USER_CODE_ALPHABET,
  normaliseCompanionUserCode,
  CompanionUserCodeSchema,
  CompanionDeviceInfoSchema,
  CompanionLinkStartRequestSchema,
  CompanionLinkStartResponseSchema,
  CompanionLinkPollRequestSchema,
  CompanionLinkPollSuccessSchema,
  CompanionLinkPollErrorCodeSchema,
  CompanionLinkPollErrorSchema,
  CompanionLinkPreviewSchema,
  CompanionLinkDecisionRequestSchema,
  CompanionDeviceSchema,
  CompanionDeviceListResponseSchema,
  CompanionDeviceRenameRequestSchema,
  CompanionDeviceSelfSchema,
  CompanionDeviceNameSchema,
  CompanionLinkPreviewRequestSchema,
} from "../companion-devices.schema.js";

const TOKEN = `rlcd_${"A".repeat(42)}-`;
const DEVICE_CODE = `${"b".repeat(42)}_`;
const ISO = "2026-10-25T12:00:00.000Z";
const info = { name: "Gaming PC", os: "windows", appVersion: "0.1.0" };

const device = {
  id: 3,
  name: "Gaming PC",
  os: "windows",
  osVersion: null,
  appVersion: "0.1.0",
  tokenHint: "AA1-",
  createdAt: ISO,
  lastUsedAt: null,
  lastUsedNetwork: null,
  revokedAt: null,
  state: "active",
};

describe("COMPANION_DEVICE_TOKEN_PATTERN", () => {
  it("accepts rlcd_ + 43 base64url chars only", () => {
    expect(COMPANION_DEVICE_TOKEN_PATTERN.test(TOKEN)).toBe(true);
    expect(COMPANION_DEVICE_TOKEN_PATTERN.test(TOKEN.slice(0, -1))).toBe(false);
    expect(COMPANION_DEVICE_TOKEN_PATTERN.test(`rlvl_${"A".repeat(43)}`)).toBe(
      false,
    );
  });
});

describe("CompanionUserCodeSchema", () => {
  it("uses the RFC 8628 base-20 alphabet", () => {
    expect(COMPANION_USER_CODE_ALPHABET).toBe("BCDFGHJKLMNPQRSTVWXZ");
  });

  it("normalises case, dashes and whitespace", () => {
    expect(normaliseCompanionUserCode(" bcdf-ghjk ")).toBe("BCDFGHJK");
    expect(CompanionUserCodeSchema.parse("bcdf ghjk")).toBe("BCDFGHJK");
  });

  it("rejects vowels, digits and wrong lengths with the user copy", () => {
    for (const bad of ["BCDF-GHJA", "BCDF-GHJ1", "BCDF-GHJ", "BCDFGHJKL"]) {
      const r = CompanionUserCodeSchema.safeParse(bad);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe(
        "That code isn't valid — check the 8 letters on your computer.",
      );
    }
  });
});

describe("CompanionDeviceInfoSchema / link start", () => {
  it("parses a device and trims its name", () => {
    const parsed = CompanionDeviceInfoSchema.parse({
      ...info,
      name: "  Gaming PC ",
      osVersion: "11",
    });
    expect(parsed.name).toBe("Gaming PC");
    expect(CompanionLinkStartRequestSchema.parse({ device: info })).toEqual({
      device: info,
    });
  });

  it("rejects an unknown os, a blank name, a non-semver version, extra keys", () => {
    expect(
      CompanionDeviceInfoSchema.safeParse({ ...info, os: "ios" }).success,
    ).toBe(false);
    expect(
      CompanionDeviceInfoSchema.safeParse({ ...info, name: "   " }).success,
    ).toBe(false);
    expect(
      CompanionDeviceInfoSchema.safeParse({ ...info, name: "x".repeat(65) })
        .success,
    ).toBe(false);
    expect(
      CompanionDeviceInfoSchema.safeParse({ ...info, appVersion: "latest" })
        .success,
    ).toBe(false);
    expect(
      CompanionDeviceInfoSchema.safeParse({ ...info, extra: 1 }).success,
    ).toBe(false);
  });

  it("parses the start response with a XXXX-XXXX code", () => {
    const res = {
      deviceCode: DEVICE_CODE,
      userCode: "BCDF-GHJK",
      verificationUri: "https://raid.example/link",
      verificationUriComplete: "https://raid.example/link#code=BCDF-GHJK",
      expiresIn: 600,
      interval: 5,
    };
    expect(CompanionLinkStartResponseSchema.parse(res)).toEqual(res);
    expect(
      CompanionLinkStartResponseSchema.safeParse({
        ...res,
        userCode: "BCDFGHJK",
      }).success,
    ).toBe(false);
  });
});

describe("link poll", () => {
  it("accepts a 43-char device code only", () => {
    expect(
      CompanionLinkPollRequestSchema.parse({ deviceCode: DEVICE_CODE }),
    ).toEqual({
      deviceCode: DEVICE_CODE,
    });
    expect(
      CompanionLinkPollRequestSchema.safeParse({
        deviceCode: DEVICE_CODE.slice(1),
      }).success,
    ).toBe(false);
  });

  it("success carries an rlcd_ bearer token and the device", () => {
    const ok = { token: TOKEN, tokenType: "Bearer", device };
    expect(CompanionLinkPollSuccessSchema.parse(ok)).toEqual(ok);
    expect(
      CompanionLinkPollSuccessSchema.safeParse({
        ...ok,
        token: `rlvl_${"A".repeat(43)}`,
      }).success,
    ).toBe(false);
  });

  it("errors use the RFC 8628 §3.5 names; slow_down carries an interval", () => {
    expect(CompanionLinkPollErrorCodeSchema.options).toEqual([
      "authorization_pending",
      "slow_down",
      "access_denied",
      "expired_token",
      "invalid_grant",
    ]);
    expect(
      CompanionLinkPollErrorSchema.parse({ error: "slow_down", interval: 10 }),
    ).toEqual({
      error: "slow_down",
      interval: 10,
    });
    expect(
      CompanionLinkPollErrorSchema.safeParse({ error: "nope" }).success,
    ).toBe(false);
  });
});

describe("approve page", () => {
  it("parses a pending preview", () => {
    const preview = {
      userCode: "BCDF-GHJK",
      device: info,
      requestedAt: ISO,
      expiresAt: ISO,
      requestedNetwork: "203.0.113.x",
      sameNetworkAsYou: false,
      status: "pending",
    };
    expect(CompanionLinkPreviewSchema.parse(preview)).toEqual(preview);
    expect(
      CompanionLinkPreviewSchema.safeParse({ ...preview, status: "approved" })
        .success,
    ).toBe(false);
  });

  it("decision normalises the code and allows an optional rename", () => {
    expect(
      CompanionLinkDecisionRequestSchema.parse({
        userCode: "bcdf-ghjk",
        decision: "approve",
      }),
    ).toEqual({ userCode: "BCDFGHJK", decision: "approve" });
    expect(
      CompanionLinkDecisionRequestSchema.parse({
        userCode: "BCDFGHJK",
        decision: "deny",
        name: " Laptop ",
      }).name,
    ).toBe("Laptop");
    expect(
      CompanionLinkDecisionRequestSchema.safeParse({
        userCode: "BCDFGHJK",
        decision: "maybe",
      }).success,
    ).toBe(false);
  });
});

describe("Devices API", () => {
  it("parses a device row and a list", () => {
    expect(CompanionDeviceSchema.parse(device)).toEqual(device);
    expect(CompanionDeviceListResponseSchema.parse({ data: [device] })).toEqual(
      { data: [device] },
    );
  });

  it("T-UNIT-6: rejects a device carrying a tokenHash key (strict)", () => {
    const r = CompanionDeviceSchema.safeParse({
      ...device,
      tokenHash: "a".repeat(64),
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("rename trims and bounds the name", () => {
    expect(
      CompanionDeviceRenameRequestSchema.parse({ name: " Desk " }),
    ).toEqual({ name: "Desk" });
    expect(
      CompanionDeviceRenameRequestSchema.safeParse({ name: "" }).success,
    ).toBe(false);
  });

  it("self shape is id + name + createdAt only", () => {
    const self = { deviceId: 3, name: "Gaming PC", createdAt: ISO };
    expect(CompanionDeviceSelfSchema.parse(self)).toEqual(self);
    expect(
      CompanionDeviceSelfSchema.safeParse({ ...self, userId: 1 }).success,
    ).toBe(false);
  });
});

describe("device display text (phishing surface, ROK-1955 review)", () => {
  const hostile: Array<[string, string]> = [
    ["a C0 control", "My\u0007PC"],
    ["a C1 control", "My\u0085PC"],
    ["a newline", "Raid Ledger\n(official)"],
    ["a line separator", "My\u2028PC"],
    ["a lone surrogate", "My\uD800PC"],
    ["a bidi override", "My\u202EPC"],
    ["a bidi isolate", "My\u2066PC"],
    ["whitespace only", "   "],
  ];

  it.each(hostile)("name rejects %s", (_label, value) => {
    expect(CompanionDeviceNameSchema.safeParse(value).success).toBe(false);
    expect(
      CompanionDeviceInfoSchema.safeParse({ ...info, name: value }).success,
    ).toBe(false);
  });

  it.each(hostile)("osVersion rejects %s", (_label, value) => {
    const parsed = CompanionDeviceInfoSchema.safeParse({
      ...info,
      osVersion: value,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts ordinary names, accents and emoji", () => {
    for (const name of ["Gaming PC", "Zoë's laptop", "Rig 🎮"]) {
      expect(CompanionDeviceNameSchema.safeParse(name).success).toBe(true);
    }
    const ok = { ...info, osVersion: "Windows 11 23H2" };
    expect(CompanionDeviceInfoSchema.safeParse(ok).success).toBe(true);
  });
});

describe("CompanionLinkPreviewRequestSchema (code in the body, not the path)", () => {
  it("parses a typed code and rejects extra keys or a missing code", () => {
    expect(
      CompanionLinkPreviewRequestSchema.safeParse({ userCode: "bcdf-ghjk" })
        .success,
    ).toBe(true);
    expect(CompanionLinkPreviewRequestSchema.safeParse({}).success).toBe(false);
    expect(
      CompanionLinkPreviewRequestSchema.safeParse({ userCode: "BCDFGHJK", x: 1 })
        .success,
    ).toBe(false);
  });
});
