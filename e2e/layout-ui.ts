import { expect, type Page } from '@playwright/test';

export type ControlTab = 'Actions' | 'Evocations' | 'More';

// Navigate through the actual accessible controls, never mutate hidden/open state.
export async function selectControlTab(page: Page, name: ControlTab) {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
}

export async function openMageDetails(page: Page, playerId: string) {
  const mage = page.locator(`.player[data-player-id="${playerId}"]`);
  if (!await mage.evaluate(element => (element as HTMLDetailsElement).open)) {
    await mage.locator('summary').click();
  }
  await expect(mage.locator('.mage-secondary')).toBeVisible();
  return mage;
}

export async function viewRetinue(page: Page, playerId: string) {
  const mage = await openMageDetails(page, playerId);
  await mage.getByRole('button', { name: /^View evocations for / }).click();
  await expect(page.getByRole('tab', { name: 'Evocations', exact: true })).toHaveAttribute('aria-selected', 'true');
  const panel = page.locator(`#retinue-${playerId}`);
  await expect(panel).toBeVisible();
  return panel;
}