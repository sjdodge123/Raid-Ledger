/**
 * Scheduling poll — Remove Participant (ROK-2020).
 * Route: /community-lineup/:lineupId/schedule/:matchId
 *
 * The creator (the admin storageState) takes people off a poll through the
 * "Manage poll ⋯" control: the ROK-1585 `role="menu"` popover at ≥1024px, the
 * ROK-1584 bottom sheet below it (`openManage` / `manageItem` pick the right
 * shell per project). Both run in the desktop AND mobile projects.
 *
 * Seeding: every test builds its OWN poll through the API (admin creator with
 * an auto-YES on the one proposed time), so no sibling spec moves our numbers.
 * Fixture slots 8 and 9 are unused by the other scheduling specs; membership
 * is per poll, so the desktop and mobile workers sharing those users is safe.
 * Each test deletes its lineup in `finally`.
 */
import { test, expect } from "./base";
import type { Page } from "@playwright/test";
import { signInContextWithJwt } from "./browser-session";
import { dismissGameTimeCheck } from "./helpers";
import {
  getAdminToken,
  apiDelete,
  apiGet,
  apiPost,
  pollForCondition,
} from "./api-helpers";
import {
  manageItem,
  openManage,
  openPollPage,
  seedFixtureVoter,
  seedPollWithSlot,
  voteAs,
  type SeededPoll,
} from "./scheduling-poll-fixtures";

/** Fixture slot of the member who votes (and is removed first). */
const VOTER_SLOT = 8;
/** Fixture slot of the member who is enrolled but never votes. */
const PENDING_SLOT = 9;

interface PollMember {
  userId: number;
  displayName: string;
  schedulingSubmittedAt: string | null;
}

interface PollState {
  members: PollMember[];
  /** YES votes on the seeded slot. */
  slotYes: number;
}

let token: string;

test.beforeAll(async () => {
  token = await getAdminToken();
});

async function readState(seeded: SeededPoll): Promise<PollState | null> {
  const data = (await apiGet(
    token,
    `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}`,
  )) as {
    match?: { members?: PollMember[] };
    slots?: { id: number; votes?: unknown[] }[];
  } | null;
  const members = data?.match?.members;
  if (!members) return null;
  const slot = data?.slots?.find((s) => s.id === seeded.slotId);
  return { members, slotYes: slot?.votes?.length ?? 0 };
}

/** Poll the API until `ok` holds — the page must never race a write. */
async function waitForState(
  seeded: SeededPoll,
  description: string,
  ok: (s: PollState) => boolean,
): Promise<PollState> {
  return pollForCondition<PollState>(
    async () => {
      const s = await readState(seeded);
      return s && ok(s) ? s : null;
    },
    { timeoutMs: 15_000, intervalMs: 500, description },
  );
}

function memberIds(s: PollState): number[] {
  return s.members.map((m) => m.userId);
}

/** Open Remove Participant from whichever Manage shell this project shows. */
async function openRemoveModal(page: Page): Promise<void> {
  await openManage(page);
  await manageItem(page, /remove participant/i).click();
}

/** Pick `userId` in the open modal, confirm, and wait for the toast. */
async function removeVia(
  page: Page,
  userId: number,
  name: string,
): Promise<void> {
  await expect(page.getByTestId("remove-poll-member-list")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId(`remove-poll-member-${userId}`).click();
  await expect(
    page.getByTestId("remove-poll-member-confirm-body"),
  ).toContainText(name);
  await page.getByTestId("remove-poll-member-confirm").click();
  await expect(page.getByText(`Removed ${name} from this poll`)).toBeVisible({
    timeout: 10_000,
  });
}

function participantsButton(page: Page) {
  return page.getByTestId("lineup-participants-button");
}

test.describe("Scheduling poll remove participant (ROK-2020)", () => {
  test("creator removes a voter, then a non-voter — counts, votes and the list follow", async ({
    page,
  }) => {
    const seeded = await seedPollWithSlot(token, 9);
    try {
      const voter = await seedFixtureVoter(token, VOTER_SLOT);
      const pending = await seedFixtureVoter(token, PENDING_SLOT);
      await voteAs(voter.jwt, seeded, seeded.slotId);
      await apiPost(
        token,
        `/lineups/${seeded.lineupId}/schedule/${seeded.pollId}/members`,
        {
          userIds: [pending.userId],
        },
      );
      const before = await waitForState(
        seeded,
        "voter + pending member enrolled",
        (s) => {
          const v = s.members.find((m) => m.userId === voter.userId);
          const p = s.members.find((m) => m.userId === pending.userId);
          return (
            !!v?.schedulingSubmittedAt &&
            !!p &&
            p.schedulingSubmittedAt === null
          );
        },
      );
      expect(before.members, "creator + voter + pending member").toHaveLength(
        3,
      );
      expect(before.slotYes, "creator auto-YES + the voter").toBe(2);
      const voterName =
        before.members.find((m) => m.userId === voter.userId)?.displayName ??
        "";
      const pendingName =
        before.members.find((m) => m.userId === pending.userId)?.displayName ??
        "";
      expect(voterName, "voter display name").not.toBe("");
      expect(pendingName, "pending member display name").not.toBe("");

      await openPollPage(page, seeded);
      await expect(participantsButton(page)).toContainText(
        /Participants\s*·\s*3/,
        { timeout: 15_000 },
      );
      await expect(page.getByTestId("scheduling-pending-voters")).toContainText(
        /\b1\s+still to vote/,
      );

      // Remove the member who VOTED: the roster shrinks and their YES goes with them.
      await openRemoveModal(page);
      await removeVia(page, voter.userId, voterName);
      const afterVoter = await waitForState(
        seeded,
        "voter removed with their vote",
        (s) => !memberIds(s).includes(voter.userId),
      );
      expect(
        memberIds(afterVoter),
        "only the voter left the roster",
      ).toHaveLength(2);
      expect(afterVoter.slotYes, "the voter's YES was deleted with them").toBe(
        1,
      );
      await expect(participantsButton(page)).toContainText(
        /Participants\s*·\s*2/,
        { timeout: 15_000 },
      );
      // The voter was never "still to vote", so that count holds at 1.
      await expect(page.getByTestId("scheduling-pending-voters")).toContainText(
        /\b1\s+still to vote/,
      );

      // The removed voter is gone from the pick list; the other member is still there.
      await openRemoveModal(page);
      await expect(page.getByTestId("remove-poll-member-list")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByTestId(`remove-poll-member-${voter.userId}`),
      ).toHaveCount(0);
      await expect(
        page.getByTestId(`remove-poll-member-${pending.userId}`),
      ).toBeVisible();

      // Remove the member who had NOT voted: "still to vote" drops to zero.
      await removeVia(page, pending.userId, pendingName);
      await waitForState(
        seeded,
        "pending member removed",
        (s) => !memberIds(s).includes(pending.userId),
      );
      await expect(participantsButton(page)).toContainText(
        /Participants\s*·\s*1/,
        { timeout: 15_000 },
      );
      await expect(page.getByTestId("scheduling-pending-voters")).toHaveCount(
        0,
      );

      // Only the creator is left, and the creator is never offered.
      await openRemoveModal(page);
      await expect(page.getByTestId("remove-poll-member-empty")).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(() => {});
    }
  });

  test("a non-manager member never sees Remove Participant", async ({
    page,
  }) => {
    const seeded = await seedPollWithSlot(token, 10);
    try {
      const member = await seedFixtureVoter(token, PENDING_SLOT);
      await voteAs(member.jwt, seeded, seeded.slotId);
      await waitForState(seeded, "member enrolled by voting", (s) =>
        memberIds(s).includes(member.userId),
      );

      await signInContextWithJwt(page.context(), member.jwt);
      await page.goto("/");
      await openPollPage(page, seeded);
      await dismissGameTimeCheck(page);
      // The roster query has resolved before the gated controls are judged absent.
      await expect(participantsButton(page)).toContainText(
        /Participants\s*·\s*2/,
        { timeout: 15_000 },
      );
      await expect(page.getByTestId("scheduling-manage")).toHaveCount(0);
      await expect(page.getByTestId("remove-poll-member-button")).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("menuitem", { name: /remove participant/i }),
      ).toHaveCount(0);
    } finally {
      await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(() => {});
    }
  });
});
