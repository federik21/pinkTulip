import { test, expect } from '@playwright/test';
import { selectControlTab, viewRetinue } from './layout-ui';

test('creating and joining a room renders the lobby without React hook errors', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  const roomId = `room-entry-${Date.now()}`;
  const mages = [
    { page: host, name: 'Room Creator', button: 'Create room' },
    { page: guest, name: 'Room Guest', button: 'Join room' },
  ];

  for (const { page } of mages) page.on('pageerror', error => errors.push(error.message));

  try {
    for (const { page, name, button } of mages) {
      await page.goto('/');
      await page.getByLabel('Mage name').fill(name);
      await page.getByLabel('Room name').fill(roomId);
      await expect(page.getByRole('button', { name: button, exact: true })).toBeEnabled();
      await page.getByRole('button', { name: button, exact: true }).click();

      await expect.poll(async () => errors.length > 0 || await page.locator('.lobby-panel').isVisible()).toBe(true);
      expect(errors, 'Room entry must not throw an uncaught render error').toEqual([]);
      await expect(page.getByRole('heading', { name: 'Gather the mages', exact: true })).toBeVisible();
      await expect(page.locator('.header-meta .badge')).toHaveText(roomId);
      await expect(page.getByRole('button', { name: 'Mark ready', exact: true })).toBeDisabled();
      const school = page.getByRole('combobox', { name: 'Starting magic school', exact: true });
      await expect(school).toHaveValue('');
      await school.selectOption('cantrip');
      await expect(page.getByRole('button', { name: 'Mark ready', exact: true })).toBeEnabled();

      // The state that caused the hook-order crash must remain usable after entry.
      const ownId = button === 'Create room' ? 'p1' : 'p2';
      await expect(page.locator(`#retinue-${ownId}`)).toBeHidden();
      await expect(page.locator(`.player[data-player-id="${ownId}"]`)).toHaveAttribute('open', '');
      await viewRetinue(page, ownId);
      const retinue = page.getByRole('region', { name: `${name} evocations`, exact: true });
      await expect(retinue).toContainText('No evocations yet.');
      await expect(page.getByRole('button', { name: `Hide evocations for ${name} (0)`, exact: true })).toHaveCount(0);
      await selectControlTab(page, 'Actions');
      await expect(retinue).toBeHidden();
      await selectControlTab(page, 'Evocations');
      await expect(retinue).toBeVisible();
      await selectControlTab(page, 'Actions');
    }

    for (const { page } of mages) {
      await expect(page.locator('.lobby-seats .seat')).toHaveCount(2);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Pass for this round/ })).toHaveCount(0);
    }

    await host.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await expect(guest.locator('.lobby-count')).toHaveText('2 / 4 mages · 1 ready');
    await guest.getByRole('button', { name: 'Mark ready', exact: true }).click();

    for (const { page } of mages) {
      await expect(page.locator('.phase-track .current span')).toHaveText('(not) Black Rose');
      await expect(page.locator('.app')).toBeVisible();
      await expect(page.locator('.lobby-panel')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    expect(errors, 'Starting the game must also render without uncaught errors').toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});