import { devices, expect, test } from '@playwright/test';

/** One player on a phone fills the table with bots and plays a whole hand. */
test('a solo player plays a full hand against bots', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByTestId('nickname').fill('Solo');
  await page.getByTestId('create-room').click();
  await page.getByTestId('fill-bots').click();
  for (const s of [1, 2, 3]) await expect(page.getByTestId(`lobby-seat-${s}`)).toContainText('Bot');
  await page.getByTestId('start').click();
  await expect(page.locator('[data-testid=hand] [data-card-id]')).toHaveCount(27);

  const deadline = Date.now() + 180_000;
  let myTurns = 0;
  while ((await page.getByTestId('hand-result').count()) === 0) {
    expect(Date.now(), 'hand did not finish in time').toBeLessThan(deadline);
    if ((await page.getByTestId('your-turn').count()) === 0) {
      await page.waitForTimeout(40);
      continue;
    }
    const table = page.getByTestId('table');
    const seq = await table.getAttribute('data-seq');
    const hint = page.getByTestId('hint');
    if ((await hint.getAttribute('data-has-hint')) === 'true') {
      await hint.click();
      await page.getByTestId('play').click();
    } else {
      await page.getByTestId('pass').click();
    }
    myTurns++;
    // Wait for the move to land (the lead can come straight back after 接风).
    await expect(table).not.toHaveAttribute('data-seq', seq!, { timeout: 5_000 });
  }

  const order = await page.getByTestId('hand-result').locator('ol li').allTextContents();
  expect(order).toHaveLength(4);
  expect(order.filter((o) => o.includes('Bot'))).toHaveLength(3);
  expect(myTurns).toBeGreaterThan(0);
  expect(errors).toEqual([]);

  // Bots are always ready, so confirming deals the next hand straight away.
  await page.getByTestId('next-hand').click();
  await expect(page.getByTestId('hand-result')).toHaveCount(0);
  await context.close();
});
