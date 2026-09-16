/**
 * Game Time block editor smoke tests (ROK-1426).
 *
 * The bug this covers: the grid set `touch-action: none`, so touching it to
 * scroll painted cells and the settings page was effectively stuck on a phone.
 * The mobile project is the one that matters here, but the editor deliberately
 * runs the same path for a mouse, so the desktop cases assert the same rules.
 *
 * ROK-1569 AC4 split the surface by viewport. Above 768px
 * `/profile/gaming/game-time` is still the seven-column `GameTimePanel`; below
 * it the page mounts the ONE-DAY phone editor
 * (`web/src/pages/profile/game-time-panel.tsx:50-59` →
 * `PhoneWeekCheckStep variant="profile"`), which renders the SAME
 * `SlotBlockLayer` for a single day and no `game-time-grid`. Every helper below
 * therefore resolves per project; the desktop assertions are untouched.
 */
// `base` re-exports `test` and `expect` only — `Page` is a Playwright type and
// comes from the package itself (importing it from `./base` type-errors, which
// nothing caught because no tsconfig covers `scripts/smoke`).
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { isMobile } from './helpers';

const GRID = 'game-time-grid';
/** The phone editor's root — `PhoneWeekEditorCore.tsx:38`. */
const PHONE_EDITOR = 'phone-week-editor';
/** The phone editor's cell grid — `DayBlockEditor.tsx:47`. */
const PHONE_GRID = 'phone-day-grid';
const LAYER = 'block-editor-layer';
/** Mirrors SELECTED_MIN_WIDTH in SlotBlockLayer.tsx. */
const SELECTED_MIN_WIDTH = 56;

/** True when this project gets the one-day phone editor (ROK-1569 AC4). */
function onPhone(): boolean {
    return isMobile(test.info());
}

async function openGameTime(page: Page): Promise<void> {
    await page.goto('/profile/gaming/game-time');
    await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });
    if (onPhone()) {
        // ROK-1579: the phone profile is a summary card; the editor lives in the
        // shared drawer behind "Edit my week" (the same drawer as the poll check).
        await page.getByTestId('profile-game-time-edit').click();
    }
    await expect(page.getByTestId(onPhone() ? PHONE_EDITOR : GRID)).toBeVisible();
}

/**
 * The editor only mounts once the grid has been measured.
 *
 * The day targets are sized from the measured row height (the phone editor's
 * rows are `1fr`, so that height only exists after layout — `DayBlockEditor`'s
 * ResizeObserver). A click dispatched before the measure lands would fall
 * through to the cell underneath, which has no handler, so wait for a real box.
 */
async function waitForLayer(page: Page): Promise<void> {
    await expect(page.getByTestId(LAYER)).toBeAttached({ timeout: 10_000 });
    await expect
        .poll(
            async () => (await page.locator('[data-testid^="slot-day-target-"]').first().boundingBox())?.height ?? 0,
            { timeout: 10_000, message: 'the block layer never measured a row height' },
        )
        .toBeGreaterThan(0);
}

/**
 * The test id of a cell that is free to tap: not locked, and not already under a
 * block. Both matter. A tap on a committed/blocked hour is deliberately a no-op,
 * and other specs in the suite hand the admin committed hours via signups.
 *
 * Returns an id rather than a point on purpose. Reading a rect here and clicking
 * those raw coordinates later leaves a window in which the page can shift under
 * the click — which is how this went flaky in the full parallel suite while
 * passing 15/15 solo. Clicking the locator re-resolves the box in the browser.
 *
 * The phone editor's cells are `phone-cell-<day>-<hour>` and carry no
 * `data-status`: it edits the viewer's own TEMPLATE only
 * (`phone-week-check.helpers.ts::toTemplateSlots`), so there are no
 * committed/blocked hours on it to skip.
 */
async function freeCellTestId(page: Page): Promise<string> {
    const prefix = onPhone() ? 'phone-cell-' : 'cell-';
    const id = await page.evaluate((cellPrefix: string) => {
        const blocks = Array.from(document.querySelectorAll('[data-testid^="slot-block-"]'))
            .map((b) => b.getBoundingClientRect());
        const covered = (r: DOMRect): boolean => blocks.some((b) =>
            r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);

        for (const cell of Array.from(document.querySelectorAll(`[data-testid^="${cellPrefix}"]`))) {
            // Interactive grids blank `available` so the block layer owns that
            // fill, so 'inactive' here means "not committed and not blocked".
            if (cellPrefix === 'cell-' && (cell as HTMLElement).dataset.status !== 'inactive') continue;
            const r = cell.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || covered(r)) continue;
            return (cell as HTMLElement).dataset.testid!;
        }
        return null;
    }, prefix);
    expect(id, 'no free cell to tap — every visible hour is locked or blocked').not.toBeNull();
    return id!;
}

/**
 * Phone only: page the strip until a day with NO block is on screen and return
 * one of its free cells. Every day in the test template can hold blocks, so
 * this is the phone counterpart of the desktop "column with no block" scan.
 */
async function emptyDayCellOnPhone(page: Page): Promise<string | null> {
    for (let d = 0; d < 7; d++) {
        await page.getByTestId(`phone-week-strip-day-${d}`).click();
        await expect(page.getByTestId(`phone-week-strip-day-${d}`)).toHaveAttribute('aria-current', 'date');
        if ((await page.locator(`[data-testid^="slot-block-${d}-"]`).count()) > 0) continue;
        return freeCellTestId(page);
    }
    return null;
}

/**
 * Drop a block and return ITS OWN test id. Tests must NOT assume the grid already
 * has one: the local demo DB has seeded availability and CI's fresh DB has none,
 * so anything keyed off an existing block passes locally and fails in CI with
 * "element(s) not found".
 *
 * The id is read back off the selection rather than composed from the day,
 * because the chosen day may already hold a block elsewhere in the column —
 * `slot-block-${day}-` would then match two and trip strict mode.
 */
async function createBlock(page: Page): Promise<string> {
    // force: the day target sits above the cell and is the real recipient, so the
    // hit-target check would reject the cell as intercepted. The point is still
    // taken from the cell's live box immediately before dispatch.
    await page.getByTestId(await freeCellTestId(page)).click({ force: true });

    // A new block is auto-selected, so the inspector proves the tap landed —
    // on both editors: `GameTimeGrid.tsx` and the phone's `DayBlockEditor.tsx`
    // (ROK-1569) mount the same `SelectedBlockInspector`.
    await expect(page.getByTestId('selected-block-inspector')).toBeVisible();
    const created = page.locator('[data-testid^="slot-block-"][data-selected="true"]');
    await expect(created).toHaveCount(1);
    const id = await created.getAttribute('data-testid');
    expect(id).not.toBeNull();
    return id!;
}

/**
 * Page the phone editor to a day that holds NO block, and return it.
 *
 * A tap two hours above an existing block merges into it, which would leave the
 * block count unchanged for a legitimate reason — the seven-column test avoids
 * that by choosing an empty column, and one day is on screen at a time here.
 */
async function openEmptyPhoneDay(page: Page): Promise<number> {
    for (let day = 0; day < 7; day++) {
        const pick = page.getByTestId(`phone-week-strip-day-${day}`);
        await pick.click();
        await expect(pick).toHaveAttribute('aria-current', 'date');
        if ((await page.locator('[data-testid^="slot-block-"]').count()) === 0) return day;
    }
    throw new Error('every day of the week already holds a block — no empty day to tap');
}

test.describe('Game Time blocks — scrolling (ROK-1426)', () => {
    test('the grid never captures touch gestures', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        // The regression itself: this was 'none', which is what broke scrolling.
        // On the phone the cells live in `HourGrid`, which is the element
        // carrying the touch-action (`DayBlockEditor.tsx:67`); it has no testid
        // of its own, so it is reached as a cell's parent.
        const surface = onPhone()
            ? page.locator('[data-testid^="phone-cell-"]').first().locator('xpath=..')
            : page.getByTestId(GRID);
        const touchAction = await surface.evaluate((el) => getComputedStyle(el).touchAction);
        expect(touchAction).toBe('pan-y');
    });

    test('every day target stays scroll-through', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        // Seven columns on desktop; the phone editor passes `days={[dayOfWeek]}`
        // to the same layer (`DayBlockEditor.tsx:54`), so exactly one target.
        const expected = onPhone() ? 1 : 7;
        const targets = page.locator('[data-testid^="slot-day-target-"]');
        await expect(targets).toHaveCount(expected);
        const actions = await targets.evaluateAll(
            (els) => els.map((el) => getComputedStyle(el).touchAction),
        );
        expect(actions).toEqual(Array(expected).fill('pan-y'));
    });

    test('the page still scrolls when the drag starts inside the grid', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Touch-scroll behaviour is mobile-specific');
        await openGameTime(page);
        await waitForLayer(page);

        const grid = page.getByTestId(PHONE_GRID);
        const box = await grid.boundingBox();
        expect(box).not.toBeNull();

        const before = await page.evaluate(() => window.scrollY);
        // A real finger swipe starting on the grid, not a synthesised wheel event.
        await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + 20);
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.wheel(0, 400);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    });
});

test.describe('Game Time blocks — editing', () => {
    test('a tap on empty space creates a block, and it can be removed again', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        // Must be a column with NO block: tapping beside one merges into it and
        // the count would legitimately stay the same. The cell must also be
        // unlocked, since a tap on a committed/blocked hour does nothing. The
        // phone shows one day at a time, so it pages through the strip until a
        // day without a block is on screen (`existing` is re-read for that day).
        const cellId = onPhone()
            ? await emptyDayCellOnPhone(page)
            : await page.evaluate(() => {
                for (let d = 0; d < 7; d++) {
                    if (document.querySelector(`[data-testid^="slot-block-${d}-"]`)) continue;
                    const cell = document.querySelector(`[data-testid^="cell-${d}-"][data-status="inactive"]`);
                    if (cell) return (cell as HTMLElement).dataset.testid!;
                }
                return null;
            });
        expect(cellId).not.toBeNull();
        const existingNow = await page.locator('[data-testid^="slot-block-"]').count();
        await page.getByTestId(cellId!).click({ force: true });

        await expect(page.getByTestId('selected-block-inspector')).toBeVisible();
        await expect(page.locator('[data-testid^="slot-block-"]')).toHaveCount(existingNow + 1);

        await page.getByTestId('remove-block').click();
        await expect(page.getByTestId('selected-block-inspector')).toBeHidden();
        await expect(page.locator('[data-testid^="slot-block-"]')).toHaveCount(existingNow);
    });

    // The phone half of the test above (ROK-1569): one day is on screen, so the
    // tap has to land on THAT day's column and nowhere else.
    test('a tap on an empty hour creates a block on the day the phone editor is showing', async ({ page }) => {
        test.skip(!onPhone(), 'Phone-only — the one-day editor (ROK-1569 AC4)');
        await openGameTime(page);
        await waitForLayer(page);

        const day = await openEmptyPhoneDay(page);
        const id = await createBlock(page);

        // Names the day, so this fails if the tap landed in another column
        // rather than merely if something rendered.
        expect(id).toMatch(new RegExp(`^slot-block-${day}-`));
        await expect(page.locator('[data-testid^="slot-block-"]')).toHaveCount(1);
    });

    // This was `fixme` for a "block renders 311px wide" defect that did not exist:
    // the layer's old testid was `slot-block-layer`, so `^="slot-block-"` matched
    // the full-width container before any block and the test compared the layer
    // against a block. The layer is now `block-editor-layer`; the prefix means a
    // block and nothing else.
    test('selecting a block reveals its handles and never shrinks it', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        const block = page.getByTestId(await createBlock(page));
        // Created blocks arrive selected; deselect (the inspector's Done, on
        // both editors) to measure the resting width.
        await page.getByTestId('deselect-block').click();
        await expect(block).not.toHaveAttribute('data-selected', 'true');
        await expect(block).toBeVisible();
        const restingWidth = (await block.boundingBox())!.width;

        await block.click();
        await expect(block).toHaveAttribute('data-selected', 'true');
        await expect(page.locator('[data-testid^="slot-handle-start-"]')).toHaveCount(1);
        await expect(page.locator('[data-testid^="slot-handle-end-"]')).toHaveCount(1);

        // A selected block has to clear a fingertip, so it grows to
        // SELECTED_MIN_WIDTH on a narrow mobile column (36px -> 56px) and stays
        // put where the column is already wider (desktop is 114px, and the
        // phone editor's single column is the whole sheet). Never a shrink,
        // either way. Polled because width is transitioned.
        const expected = Math.max(restingWidth, SELECTED_MIN_WIDTH);
        await expect
            .poll(async () => Math.round((await block.boundingBox())!.width))
            .toBe(Math.round(expected));

        await page.getByTestId('remove-block').click();
    });

    // Regression: statically placed, the inspector rendered at y=733 in a 727px
    // mobile viewport -- every control below the fold, with no cue. The stepper
    // is meant to be the precise AND accessible path, so it has to be on screen.
    test('the inspector is on screen once a block is selected', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        // Creating a block selects it, which is what opens the inspector.
        await createBlock(page);
        const inspector = page.getByTestId('selected-block-inspector');

        const box = (await inspector.boundingBox())!;
        const viewportHeight = page.viewportSize()!.height;
        const position = await inspector.evaluate((el) => getComputedStyle(el).position);

        // Pinned on both, so selecting a block never puts its own controls out of
        // reach: in flow it landed at y=733 in a 727px mobile viewport, and at
        // 681-771 in a 720px desktop window, which cut off both steppers.
        expect(position).toBe('sticky');
        expect(box.y).toBeGreaterThanOrEqual(0);

        // Mobile must additionally clear the fixed h-14 (56px) bottom tab bar,
        // which desktop does not have.
        const floor = test.info().project.name === 'mobile' ? 56 : 0;
        expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight - floor);

        await page.getByTestId('remove-block').click();
    });

    // The block layer covers the cells, so a cell's own onPointerEnter stops
    // firing while editing -- which silently killed both the hover tooltip and
    // the hover glow. Hover is reported from the layer instead.
    test('hovering the grid still shows the tooltip and the glow while editing', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Hover is a mouse affordance');
        await openGameTime(page);
        await waitForLayer(page);

        const tooltip = page.getByTestId('game-time-hover-tooltip');
        await expect(tooltip).toHaveCount(0);

        // Hover a day column, over the layer -- not a cell, which is underneath it.
        const target = page.getByTestId('slot-day-target-2');
        const box = (await target.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

        // Names the actual cell, so this fails if the coordinate maths is wrong
        // rather than merely if something rendered.
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveText(/^Tuesday \d{1,2} (AM|PM) – \d{1,2} (AM|PM)/);

        // The glow is painted as the grid's background, so it proves the hover
        // reached useHoverGlow and not just the tooltip.
        await expect
            .poll(async () => page.getByTestId(GRID).evaluate((el) => el.style.background))
            .toContain('radial-gradient');

        // Leaving the grid clears it.
        await page.mouse.move(box.x + box.width / 2, box.y - 200);
        await expect(tooltip).toHaveCount(0);
    });

    test('the steppers move the block bounds without dragging', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        // The phone editor shows ONE day, so a fixed Tuesday target only exists on
        // Tuesdays (it failed on CI every other weekday). Page the strip to an empty
        // day on the phone; desktop shows all seven and keeps Tuesday.
        const day = onPhone() ? await openEmptyPhoneDay(page) : 2;
        const target = page.getByTestId(`slot-day-target-${day}`);
        const box = await target.boundingBox();
        await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 3);
        await expect(page.getByTestId('selected-block-inspector')).toBeVisible();

        const endBefore = await page.getByTestId('end-value').textContent();
        await page.getByTestId('end-later').click();
        await expect(page.getByTestId('end-value')).not.toHaveText(endBefore ?? '');

        await page.getByTestId('remove-block').click();
    });
});

/**
 * Reveal the absence form.
 *
 * Desktop has the panel's own "Absence" toggle. The phone profile has no such
 * button: the absence row is behind "I'm away…"
 * (`PhoneWeekCheckStep.tsx:62-78`), which reveals the SHIPPED `AbsenceSection`
 * — whose own toggle reads "Add Absence" (`game-time-absence.tsx:182-184`).
 */
async function openAbsenceForm(page: Page): Promise<void> {
    if (!onPhone()) {
        await page.getByRole('button', { name: 'Absence', exact: true }).click();
        return;
    }
    await page.getByTestId('phone-week-away').click();
    const panel = page.getByTestId('phone-week-absence-panel');
    await expect(panel).toBeVisible();
    // `.first()`: once the form is open its submit button carries the same
    // accessible name, and the section's own toggle is first in DOM order.
    await panel.getByRole('button', { name: 'Add Absence' }).first().click();
}

test.describe('Game Time absences — mobile form (ROK-1426)', () => {
    test('presets fill the range and report an inclusive day count', async ({ page }) => {
        await openGameTime(page);

        await openAbsenceForm(page);
        await expect(page.getByTestId('absence-submit')).toBeVisible();

        // Submit stays gated until there is a valid range.
        await expect(page.getByTestId('absence-submit')).toBeDisabled();

        await page.getByTestId('absence-pick-weekend').click();
        await expect(page.getByTestId('absence-span')).toHaveText('2 days');
        await expect(page.getByTestId('absence-submit')).toBeEnabled();

        await page.getByTestId('absence-pick-next-week').click();
        await expect(page.getByTestId('absence-span')).toHaveText('7 days');

        // Custom clears both dates and re-gates submit.
        await page.getByTestId('absence-pick-custom').click();
        await expect(page.getByTestId('absence-span')).toHaveText('');
        await expect(page.getByTestId('absence-submit')).toBeDisabled();
    });

    test('the date fields are full width rather than wrapping', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile layout assertion');
        await openGameTime(page);

        await openAbsenceForm(page);
        const from = page.getByLabel('From', { exact: true });
        const to = page.getByLabel('To', { exact: true });
        await expect(from).toBeVisible();

        // Stacked, not side by side: the To field sits below the From field.
        const fromBox = (await from.boundingBox())!;
        const toBox = (await to.boundingBox())!;
        expect(toBox.y).toBeGreaterThan(fromBox.y + fromBox.height - 1);
    });
});
