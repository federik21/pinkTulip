import { expect, type Page } from '@playwright/test';

export type ControlTab = 'Physical actions' | 'Spells' | 'Evocations' | 'Quests' | 'Actions' | 'More';

// Navigate through the actual accessible controls, never mutate hidden/open state.
export async function selectControlTab(page: Page, name: ControlTab) {
  // Keep older rules scenarios readable without asserting obsolete tab labels.
  const label = name === 'Actions' ? 'Physical actions' : name === 'More' ? 'Spells' : name;
  const tab = page.getByRole('tab', { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: label, exact: true })).toBeVisible();
}

export const selectSpells = (page: Page) => selectControlTab(page, 'Spells');

export async function openQuickReference(page: Page) {
  await page.getByRole('button', { name: 'Quick reference', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick reference', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.reference')).toBeVisible();
  return dialog;
}

export async function closeQuickReference(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Quick reference', exact: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Quick reference', exact: true })).toBeFocused();
}

export async function expectReference(page: Page, text: string | RegExp) {
  const dialog = await openQuickReference(page);
  await expect(dialog.locator('.reference')).toContainText(text);
  await closeQuickReference(page);
}

export async function selectStudyDraw(page: Page, deckIds: string[]) {
  expect(deckIds).toHaveLength(4);
  const confirm = page.getByRole('button', { name: /^Draw selected cards/ });
  await expect(confirm).toBeDisabled();
  for (const [index, id] of deckIds.entries()) {
    await page.locator(`.schools button[data-school-id="${id}"]`).click();
    if (index < 3) await expect(confirm).toBeDisabled();
  }
  await expect(confirm).toBeEnabled();
  await confirm.click();
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