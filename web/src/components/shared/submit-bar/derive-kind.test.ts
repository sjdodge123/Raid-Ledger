/**
 * Failing-first tests for `deriveSubmitKind` (ROK-1296 / U4).
 *
 * Source file does not yet exist — these MUST fail with module-not-found
 * until the dev implements `web/src/components/shared/submit-bar/derive-kind.ts`.
 *
 * Contract (from spec ROK-1296 §UI States):
 *   deriveSubmitKind({ submittedAt, hasAnyAction, hasFullAction })
 *     → 'empty' | 'partial' | 'pre' | 'post'
 *
 * Decision table:
 *   submittedAt != null                                            → 'post'
 *   submittedAt == null && hasAnyAction === false                  → 'empty'
 *   submittedAt == null && hasAnyAction && !hasFullAction          → 'partial'
 *   submittedAt == null && hasFullAction                           → 'pre'
 *
 * `submittedAt` always wins. If the lineup has been submitted, the kind is
 * 'post' regardless of how many votes / nominations the user has touched
 * since (composites decide whether to render "Change my X" affordance).
 */
import { describe, it, expect } from 'vitest';
import { deriveSubmitKind } from './derive-kind';

describe('deriveSubmitKind — post wins whenever submittedAt is set', () => {
    it("returns 'post' when submittedAt is a valid ISO string and no actions taken", () => {
        expect(
            deriveSubmitKind({
                submittedAt: '2026-05-16T19:00:00.000Z',
                hasAnyAction: false,
                hasFullAction: false,
            }),
        ).toBe('post');
    });

    it("returns 'post' when submittedAt is set even if hasFullAction is true", () => {
        expect(
            deriveSubmitKind({
                submittedAt: '2026-05-16T19:00:00.000Z',
                hasAnyAction: true,
                hasFullAction: true,
            }),
        ).toBe('post');
    });

    it("returns 'post' when submittedAt is set even if only partial action taken", () => {
        expect(
            deriveSubmitKind({
                submittedAt: '2026-05-16T19:00:00.000Z',
                hasAnyAction: true,
                hasFullAction: false,
            }),
        ).toBe('post');
    });
});

describe('deriveSubmitKind — unsubmitted decision table', () => {
    it("returns 'empty' when nothing is submitted and no action taken", () => {
        expect(
            deriveSubmitKind({
                submittedAt: null,
                hasAnyAction: false,
                hasFullAction: false,
            }),
        ).toBe('empty');
    });

    it("returns 'partial' when some action taken but not full", () => {
        expect(
            deriveSubmitKind({
                submittedAt: null,
                hasAnyAction: true,
                hasFullAction: false,
            }),
        ).toBe('partial');
    });

    it("returns 'pre' when hasFullAction is true (full allotment used)", () => {
        // hasFullAction implies hasAnyAction; both true is the canonical
        // "ready to submit" state.
        expect(
            deriveSubmitKind({
                submittedAt: null,
                hasAnyAction: true,
                hasFullAction: true,
            }),
        ).toBe('pre');
    });

    it("returns 'pre' when hasFullAction is true even if hasAnyAction is false (defensive)", () => {
        // hasFullAction implies any-action; if a caller passes the inconsistent
        // combination, hasFullAction should still win (it's the stronger
        // predicate). This guards against composites that derive only one
        // of the two flags.
        expect(
            deriveSubmitKind({
                submittedAt: null,
                hasAnyAction: false,
                hasFullAction: true,
            }),
        ).toBe('pre');
    });
});

describe('deriveSubmitKind — edge values', () => {
    it("treats empty-string submittedAt as null and falls through to action state", () => {
        // The viewerSubmissions field is `string | null`; defensive guard
        // against an empty string sneaking through serialization.
        expect(
            deriveSubmitKind({
                submittedAt: '',
                hasAnyAction: false,
                hasFullAction: false,
            }),
        ).toBe('empty');
    });

    it('treats undefined submittedAt as not-submitted', () => {
        expect(
            deriveSubmitKind({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                submittedAt: undefined as any,
                hasAnyAction: true,
                hasFullAction: false,
            }),
        ).toBe('partial');
    });
});
