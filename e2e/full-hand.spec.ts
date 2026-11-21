import { devices, expect, test, type Page } from '@playwright/test';

/**
 * Four separate browser contexts (one an iPhone in portrait) create and join a room,
 * then play an entire hand through the real UI using the hint button — until every
 * player sees the end-of-hand screen.
 */
test('four players play a full hand', async ({ browser }) => {
  const contexts = await Promise.all([
    browser.newContext({ ...devices['iPhone 13'] }),
    browser.newContext(),
    browser.newContext({ ...devices['Pixel 7'] }),
    browser.newContext(),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  pages.forEach((p, i) => p.on('pageerror', (e) => errors.push(`page ${i}: ${e.message}`)));

  // Host creates the room.
  const [host] = pages;
  await host!.goto('/');
  await host!.getByTestId('nickname').fill('Lin');
  await host!.getByTestId('create-room').click();
  const code = (await host!.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  // Three friends join through the invite link and ready up.
  const names = ['Mei', 'Bo', 'Kai'];
  for (let i = 1; i < 4; i++) {
    const p = pages[i]!;
    await p.goto(`/?room=${code}`);
    await p.getByTestId('nickname').fill(names[i - 1]!);
    await p.getByTestId('join-room').click();
    await expect(p.getByTestId('room-code')).toHaveText(code);
    await p.getByTestId('ready').click();
  }

  await expect(host!.getByTestId('start')).toBeEnabled();
  await host!.getByTestId('start').click();
  for (const p of pages) await expect(p.getByTestId('hand')).toBeVisible();

  // Every player starts with 27 cards and sees only their own.
  for (const p of pages) await expect(p.locator('[data-testid=hand] [data-card-id]')).toHaveCount(27);
  const seen = new Set<string>();
  for (const p of pages) {
    for (const id of await p.locator('[data-testid=hand] [data-card-id]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-card-id')!),
    )) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  }
  expect(seen.size).toBe(108);

  const resultShown = async () =>
    (await Promise.all(pages.map((p) => p.getByTestId('hand-result').count()))).every((n) => n > 0);

  const takeTurn = async (p: Page) => {
    // Every accepted move bumps the table's event sequence number. (Waiting for "your
    // turn" to disappear is not enough: after 接风 the lead can come straight back.)
    const table = p.getByTestId('table');
    const seq = await table.getAttribute('data-seq');
    const hint = p.getByTestId('hint');
    if ((await hint.getAttribute('data-has-hint')) === 'true') {
      await hint.click();
      await p.getByTestId('play').click();
      const sheet = p.getByTestId('choice-sheet');
      if (await sheet.isVisible().catch(() => false)) await sheet.getByRole('button').first().click();
    } else {
      await p.getByTestId('pass').click();
    }
    await expect(table).not.toHaveAttribute('data-seq', seq!, { timeout: 5_000 });
  };

  let turns = 0;
  const deadline = Date.now() + 200_000;
  while (!(await resultShown())) {
    expect(Date.now(), 'hand did not finish in time').toBeLessThan(deadline);
    let acted = false;
    for (const p of pages) {
      if ((await p.getByTestId('your-turn').count()) > 0) {
        await takeTurn(p);
        turns++;
        acted = true;
      }
    }
    if (!acted) await host!.waitForTimeout(50);
  }

  // Everyone sees the same finish order with all four players.
  const orders = await Promise.all(
    pages.map((p) => p.getByTestId('hand-result').locator('ol li').allTextContents()),
  );
  for (const o of orders) {
    expect(o).toHaveLength(4);
    for (const n of ['Lin', 'Mei', 'Bo', 'Kai']) expect(o.join(' ')).toContain(n);
  }
  expect(turns).toBeGreaterThan(10);
  expect(errors).toEqual([]);

  // Confirming the result deals hand 2 for everyone.
  for (const p of pages) await p.getByTestId('next-hand').click();
  for (const p of pages) await expect(p.getByTestId('hand-result')).toHaveCount(0);

  await Promise.all(contexts.map((c) => c.close()));
});
