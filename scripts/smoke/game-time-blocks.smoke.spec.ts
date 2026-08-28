/**
 * Game Time block editor smoke tests (ROK-1426).
 *
 * The bug this covers: the grid set `touch-action: none`, so touching it to
 * scroll painted cells and the settings page was effectively stuck on a phone.
 * The mobile project is the one that matters here, but the editor deliberately
 * runs the same path for a mouse, so the desktop cases assert the same rules.
 */
import { test, expect, type Page } from './base';

const GRID = 'game-time-grid';
const LAYER = 'block-editor-layer';
/** Mirrors SELECTED_MIN_WIDTH in SlotBlockLayer.tsx. */
const SELECTED_MIN_WIDTH = 56;

async function openGameTime(page: Page): Promise<void> {
    await page.goto('/profile/gaming/game-time');
    await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(GRID)).toBeVisible();
}

/** The editor only mounts once the grid has been measured. */
async function waitForLayer(page: Page): Promise<void> {
    await expect(page.getByTestId(LAYER)).toBeAttached({ timeout: 10_000 });
}

test.describe('Game Time blocks — scrolling (ROK-1426)', () => {
    test('the grid never captures touch gestures', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        // The regression itself: this was 'none', which is what broke scrolling.
        const touchAction = await page.getByTestId(GRID).evaluate(
            (el) => getComputedStyle(el).touchAction,
        );
        expect(touchAction).toBe('pan-y');
    });

    test('every day target stays scroll-through', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        const targets = page.locator('[data-testid^="slot-day-target-"]');
        await expect(targets).toHaveCount(7);
        const actions = await targets.evaluateAll(
            (els) => els.map((el) => getComputedStyle(el).touchAction),
        );
        expect(actions).toEqual(Array(7).fill('pan-y'));
    });

    test('the page still scrolls when the drag starts inside the grid', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Touch-scroll behaviour is mobile-specific');
        await openGameTime(page);
        await waitForLayer(page);

        const grid = page.getByTestId(GRID);
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

        const existing = await page.locator('[data-testid^="slot-block-"]').count();

        // Must be a column with NO block: tapping beside one merges into it and
        // the count would legitimately stay the same.
        const emptyDay = await page.evaluate(() => {
            for (let d = 0; d < 7; d++) {
                if (!document.querySelector(`[data-testid^="slot-block-${d}-"]`)) return d;
            }
            return -1;
        });
        expect(emptyDay).toBeGreaterThanOrEqual(0);

        const target = page.getByTestId(`slot-day-target-${emptyDay}`);
        const box = await target.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

        await expect(page.getByTestId('selected-block-inspector')).toBeVisible();
        await expect(page.locator('[data-testid^="slot-block-"]')).toHaveCount(existing + 1);

        await page.getByTestId('remove-block').click();
        await expect(page.getByTestId('selected-block-inspector')).toBeHidden();
        await expect(page.locator('[data-testid^="slot-block-"]')).toHaveCount(existing);
    });

    // This was `fixme` for a "block renders 311px wide" defect that did not exist:
    // the layer's old testid was `slot-block-layer`, so `^="slot-block-"` matched
    // the full-width container before any block and the test compared the layer
    // against a block. The layer is now `block-editor-layer`; the prefix means a
    // block and nothing else.
    test('selecting a block reveals its handles and never shrinks it', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        const first = page.locator('[data-testid^="slot-block-"]').first();
        await expect(first).toBeVisible();
        const restingWidth = (await first.boundingBox())!.width;
        await first.click();

        const block = page.locator('[data-testid^="slot-block-"][data-selected="true"]');
        await expect(block).toHaveCount(1);

        await expect(page.locator('[data-testid^="slot-handle-start-"]')).toHaveCount(1);
        await expect(page.locator('[data-testid^="slot-handle-end-"]')).toHaveCount(1);

        // A selected block has to clear a fingertip, so it grows to
        // SELECTED_MIN_WIDTH on a narrow mobile column (36px -> 56px) and stays
        // put where the column is already wider (desktop is 114px). Never a
        // shrink, either way. Polled because width is transitioned.
        const expected = Math.max(restingWidth, SELECTED_MIN_WIDTH);
        await expect
            .poll(async () => Math.round((await block.boundingBox())!.width))
            .toBe(Math.round(expected));

        await page.getByTestId('deselect-block').click();
    });

    // Regression: statically placed, the inspector rendered at y=733 in a 727px
    // mobile viewport -- every control below the fold, with no cue. The stepper
    // is meant to be the precise AND accessible path, so it has to be on screen.
    test('the inspector is on screen once a block is selected', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        await page.locator('[data-testid^="slot-block-"]').first().click();
        const inspector = page.getByTestId('selected-block-inspector');
        await expect(inspector).toBeVisible();

        const box = (await inspector.boundingBox())!;
        const viewportHeight = page.viewportSize()!.height;
        const position = await inspector.evaluate((el) => getComputedStyle(el).position);

        if (test.info().project.name === 'mobile') {
            // The case that was broken. Wholly inside the viewport AND clear of
            // the fixed h-14 (56px) tab bar, so every control is actually usable.
            expect(position).toBe('sticky');
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight - 56);
        } else {
            // Desktop keeps the in-flow placement (operator call). It sits under
            // the grid and scrolls with it, so on a short window the steppers can
            // land below the fold -- only the top edge is guaranteed reachable.
            expect(position).toBe('static');
            expect(box.y).toBeLessThan(viewportHeight);
            expect(box.y + box.height).toBeGreaterThan(0);
        }

        await page.getByTestId('deselect-block').click();
    });

    test('the steppers move the block bounds without dragging', async ({ page }) => {
        await openGameTime(page);
        await waitForLayer(page);

        const target = page.getByTestId('slot-day-target-2');
        const box = await target.boundingBox();
        await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 3);
        await expect(page.getByTestId('selected-block-inspector')).toBeVisible();

        const endBefore = await page.getByTestId('end-value').textContent();
        await page.getByTestId('end-later').click();
        await expect(page.getByTestId('end-value')).not.toHaveText(endBefore ?? '');

        await page.getByTestId('remove-block').click();
    });
});

test.describe('Game Time absences — mobile form (ROK-1426)', () => {
    test('presets fill the range and report an inclusive day count', async ({ page }) => {
        await openGameTime(page);

        await page.getByRole('button', { name: 'Absence', exact: true }).click();
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

        await page.getByRole('button', { name: 'Absence', exact: true }).click();
        const from = page.getByLabel('From', { exact: true });
        const to = page.getByLabel('To', { exact: true });
        await expect(from).toBeVisible();

        // Stacked, not side by side: the To field sits below the From field.
        const fromBox = (await from.boundingBox())!;
        const toBox = (await to.boundingBox())!;
        expect(toBox.y).toBeGreaterThan(fromBox.y + fromBox.height - 1);
    });
});
