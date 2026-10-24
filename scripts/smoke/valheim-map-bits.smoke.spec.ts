/**
 * ROK-1949 — the Map-tab smoke spec scans a 2048² fog bitset per test. The
 * scan must stay a cheap synchronous loop: a Playwright `expect()` per bit
 * hung three CI shards (the worker's event loop never yielded, so the test
 * timeout could not fire).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { bitSet, findTexel } from "./valheim-map-bits";

const N = 2048;

/** n² bitset with exactly one set bit at `i`. */
function oneBit(i: number): Uint8Array {
  const bits = new Uint8Array(Math.ceil((N * N) / 8));
  bits[i >> 3] = 1 << (i & 7);
  return bits;
}

test.describe("valheim-map-bits", () => {
  test("finds the first set / unset texel in the union of two layers", () => {
    const lit = N * 1000 + 7; // py 1000, px 7
    const empty = new Uint8Array(Math.ceil((N * N) / 8));
    expect(findTexel(N, empty, oneBit(lit), true)).toEqual({ px: 7, py: 1000 });
    expect(findTexel(N, oneBit(0), empty, false)).toEqual({ px: 1, py: 0 });
    expect(findTexel(N, empty, empty, true)).toBeNull();
  });

  test("scans a full 2048² grid well inside a test timeout", () => {
    const empty = new Uint8Array(Math.ceil((N * N) / 8));
    const last = N * N - 1;
    const t0 = performance.now();
    const hit = findTexel(N, empty, oneBit(last), true);
    const ms = performance.now() - t0;
    expect(hit).toEqual({ px: N - 1, py: N - 1 });
    expect(ms, `full 2048² scan took ${ms.toFixed(0)} ms`).toBeLessThan(2_000);
  });

  test("throws on an out-of-range bit instead of reading past the bitset", () => {
    expect(() => bitSet(new Uint8Array(1), 8)).toThrow("bit 8 is past 1 B");
  });

  test("never imports @playwright/test (no expect() inside the scan loop)", () => {
    const src = readFileSync(join(__dirname, "valheim-map-bits.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/@playwright\/test|from ['"]\.\/defined['"]/);
  });
});
