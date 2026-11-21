import { devices, expect, test } from '@playwright/test';

/**
 * The effects preview needs no server-side state, so it is a cheap way to drive the
 * whole staging pipeline (rules engine → events → director → canvas/DOM effects).
 */
test('effects preview stages the big moments without errors', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByTestId('showcase-link').click();

  // Four jokers: three seals are stamped (天 · 王 · 炸) and the cards land on the table.
  await page.locator('[data-scene=jokers]').click();
  await expect(page.locator('.fx-seal')).toHaveCount(3, { timeout: 8_000 });
  await expect(page.getByTestId('trick-0').locator('[data-card-id]')).toHaveCount(4);

  // A deal: 27 cards arrive, and the level rank is brushed onto the felt.
  await page.getByTestId('scenes-open').click();
  await page.locator('[data-scene=deal]').click();
  await expect(page.locator('[data-testid=hand] [data-card-id]')).toHaveCount(27);
  await expect(page.locator('.fx-brush')).toHaveCount(1, { timeout: 6_000 });

  // Winning first and second: seats get their place seals, then the result sheet
  // counts the level up.
  await page.getByTestId('scenes-open').click();
  await page.locator('[data-scene=win]').click();
  await expect(page.locator('.seal-badge[data-place="1"]')).toBeVisible({ timeout: 6_000 });
  await expect(page.getByTestId('hand-result')).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId('level-change')).toContainText('Q', { timeout: 8_000 });

  // Reduced effects: the same bomb plays with no flying ghosts or particles, and the
  // seal still appears so nothing is lost.
  await page.getByTestId('next-hand').click();
  await page.getByTestId('fx-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-fx', 'reduced');
  await page.getByTestId('scenes-open').click();
  await page.locator('[data-scene=bombs]').click();
  await expect(page.locator('.fx-seal')).toHaveCount(1, { timeout: 8_000 });
  await expect(page.locator('.fx-ghost')).toHaveCount(0);

  expect(errors).toEqual([]);
  await context.close();
});
