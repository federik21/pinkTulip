import { expect, type Locator, type Page } from '@playwright/test';

export type ControlTab = 'Physical actions' | 'Spells' | 'Evocations' | 'Quests' | 'Actions' | 'More';

// Navigate through the actual accessible controls, never mutate hidden/open state.
export type PanelLabel = 'Physical actions' | 'Spells' | 'Evocations' | 'Quests';
export const PANEL_IDS: Record<PanelLabel, string> = { 'Physical actions': 'actions', Spells: 'spells', Evocations: 'evocations', Quests: 'quests' };

// The dashboard has no tab bar: exactly one labelled panel is selected, the rest keep the hidden attribute.
export async function expectPanelSelected(page: Page, label: PanelLabel) {
  for (const [name, id] of Object.entries(PANEL_IDS)) {
    await expect(page.locator(`#controls-panel-${id}`)).toHaveJSProperty('hidden', name !== label);
  }
}

export async function selectControlTab(page: Page, name: ControlTab) {
  // Keep older rules scenarios readable without asserting obsolete tab labels.
  const label: PanelLabel = name === 'Actions' ? 'Physical actions' : name === 'More' ? 'Spells' : name;
  // The dashboard only exists when opened from the dock; the dock chooses which panel it shows.
  await page.getByRole('button', { name: `Open ${label.toLowerCase()}`, exact: true }).click();
  await expectPanelSelected(page, label);
  await expect(page.getByRole('region', { name: label, exact: true })).toBeVisible();
}

export async function completeSetupDraft(pages:Page[]) {
 for(let picks=0;picks<8;picks++) {
  const setupPages:Page[]=[];
  for(const page of pages)if(await page.locator('.setup-panel').count())setupPages.push(page);
  if(!setupPages.length)return;
  for(const page of setupPages) {
   const overlay=page.locator('.phase-overlay');
   if(await overlay.isVisible())await overlay.click();
  }
  let picker:Page|undefined;
  for(const page of setupPages)if((await page.locator('.setup-panel .notice').textContent())?.includes('It is your pick.'))picker=page;
  if(picker) {
   const before=await Promise.all(setupPages.map(page=>page.locator('.setup-panel').innerText()));
   const option=picker.locator('.setup-panel .schools button:enabled').first();
   await expect(option).toBeVisible();
   await option.click();
   await expect.poll(()=>Promise.all(setupPages.map(page=>page.locator('.setup-panel').innerText()))).not.toEqual(before);
  } else {
   const before=await Promise.all(setupPages.map(page=>page.locator('.setup-panel').innerText()));
   await expect.poll(()=>Promise.all(setupPages.map(page=>page.locator('.setup-panel').innerText()))).not.toEqual(before);
  }
 }
 throw new Error('Setup draft did not finish within eight picks');
}

export const selectSpells = (page: Page) => selectControlTab(page, 'Spells');

// The controls only exist as the dock-opened dashboard; dismiss it to reach the map and roster.
export async function closeControls(page: Page) {
  const back = page.getByRole('button', { name: 'Close controls', exact: true });
  if (await back.isVisible()) await back.click();
  await expect(page.locator('.control-banner-slot')).toBeHidden();
}

// Undo/Redo sit in the sticky acting-mage banner, always reachable without opening the dashboard.
export async function pressHistory(page: Page, name: 'Undo action' | 'Redo action') {
  await page.getByRole('button', { name, exact: true }).click();
}

export async function openChronicle(page: Page) {
  const trigger = page.getByRole('button', { name: 'Open Chronicle', exact: true, includeHidden: true });
  const dialog = page.locator('dialog#chronicle-drawer');
  await expect(trigger).toHaveAttribute('aria-controls', 'chronicle-drawer');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('dialog', { name: 'Chronicle', exact: true })).toHaveAttribute('id', 'chronicle-drawer');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.matches(':modal')), 'Chronicle uses a native modal dialog').toBe(true);
  await expect(dialog.getByRole('heading', { name: 'Chronicle', exact: true })).toBeVisible();
  await expect(dialog.getByRole('log')).toBeVisible();
  return dialog;
}

export async function closeChronicle(page: Page) {
  const dialog = page.locator('dialog#chronicle-drawer');
  await dialog.getByRole('button', { name: 'Close Chronicle', exact: true }).click();
  await expect(dialog).toBeHidden();
  const trigger = page.getByRole('button', { name: 'Open Chronicle', exact: true });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
}

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

export type PreparationSlot = 1 | 2 | 3 | 'Quick';

// Preparation is deliberately two actions: choosing a hand card never places it.
export async function assignPreparationCard(page: Page, card: Locator, slot: PreparationSlot) {
  const panel = page.locator('.preparation-panel');
  const destination = slot === 'Quick' ? 'Quick slot' : `slot ${slot}`;
  const name = (await card.locator('strong').textContent())!;
  await card.click();
  await expect(card).toHaveClass(/\bchosen\b/);
  await expect(panel.locator('.cards .spell.chosen')).toHaveCount(1);
  const button = panel.locator('.preparation-order').getByRole('button', { name: `Place in ${destination}`, exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(panel.locator('.cards .spell.chosen')).toHaveCount(0);
  await expect(card.getByText(new RegExp(`^In ${destination}(?:\\s*·.*)?$`))).toBeVisible();
  await expect(panel.locator('.preparation-order')).toContainText(name);
  for (const label of ['slot 1', 'slot 2', 'slot 3', 'Quick slot']) {
    await expect(panel.locator('.preparation-order').getByRole('button', { name: `Place in ${label}`, exact: true })).toBeDisabled();
  }
}

export async function openMageDetails(page: Page, playerId: string) {
  await closeControls(page);
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
  await expectPanelSelected(page, 'Evocations');
  const panel = page.locator(`#retinue-${playerId}`);
  await expect(panel).toBeVisible();
  return panel;
}