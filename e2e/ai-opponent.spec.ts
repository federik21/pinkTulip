import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../packages/game-engine/src';
import { assignPreparationCard, closeControls, selectControlTab, selectStudyDraw } from './layout-ui';

function observe(page: Page) {
 let latest: GameState;
 const states: GameState[] = [];
 page.on('websocket', socket => socket.on('framereceived', frame => {
  const message = JSON.parse(String(frame.payload));
  if (message.type === 'STATE') { latest = message.state; states.push(latest); }
 }));
 return { get state() { return latest; }, states };
}
async function dismissPhase(page: Page, name: string) {
 await expect(page.locator('.phase-track .current span')).toHaveText(name);
 const overlay = page.locator('.phase-overlay');
 await expect(overlay).toBeVisible();
 await overlay.click();
 await expect(overlay).toBeHidden();
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
 test(`solo mage adds AI and plays a real server-controlled turn at ${viewport.width}px`, async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const wire = observe(page), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Mage name').fill('Solo challenger');
  await page.getByLabel('Room name').fill(`ai-${viewport.width}-${Date.now()}`);
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add AI opponent', exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  const ai = page.locator('.seat[data-player-id="p2"]');
  await expect(ai).toContainText('Basic AI');
  await expect(ai).toContainText('✓ Ready');
  await expect(ai).toContainText('Agony');
  expect(wire.state.players[1]).toMatchObject({ isBot: true, connected: true, ready: true });
  await ai.getByRole('button', { name: 'Remove AI Mage 2', exact: true }).click();
  await expect(page.locator('.lobby-seats .seat')).toHaveCount(1);
  await add.click();
  await expect(ai).toContainText('✓ Ready');
  await page.getByRole('combobox', { name: 'Starting magic school' }).selectOption('agony');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach(`ai-lobby-${viewport.width}`, { body: await page.locator('.lobby-panel').screenshot(), contentType: 'image/png' });
  await page.getByRole('button', { name: 'Mark ready', exact: true }).click();
  await dismissPhase(page, 'Pink Tulip');
  expect(wire.state.players[1].isBot).toBe(true);
  await page.getByRole('button', { name: /^Receive quests & begin Study/ }).click();
  await dismissPhase(page, 'Study');
  await expect.poll(() => wire.state.players[1].studyDone).toBe(true);
  expect(wire.state.players[1].hand.every(c => c.name === 'Hidden spell')).toBe(true);
  expect(wire.state.players[1]).not.toHaveProperty('studyCardIds');
  await selectStudyDraw(page, ['agony', 'agony', 'agony', 'agony']);
  const choices = page.locator('.phase-panel .spell:enabled');
  await expect(choices).toHaveCount(4);
  await choices.nth(0).click(); await choices.nth(1).click();
  await page.getByRole('button', { name: 'Discard selected (2/2)', exact: true }).click();
  await dismissPhase(page, 'Preparation');
  await expect.poll(() => wire.state.players[1].preparationDone).toBe(true);
  const hand = page.locator('.preparation-panel .cards .spell');
  for (const [index, slot] of ([1, 2, 3, 'Quick'] as const).entries()) await assignPreparationCard(page, hand.nth(index), slot);
  await page.locator('.preparation-panel').getByRole('button', { name: 'Done', exact: true }).click();
  await dismissPhase(page, 'Action');
  await selectControlTab(page, 'Physical actions');
  await page.getByRole('button', { name: /^Explore\b/ }).click();
  await closeControls(page);
  await page.locator('.physical-shortcuts').getByRole('button', { name: 'Move 2', exact: true }).click();
  for (const room of ['room-1,0', 'room-0,0']) {
   const hex = page.locator(`.hex[data-room-id="${room}"]`);
   await expect(hex).toHaveClass(/\breachable\b/);
   await hex.click();
  }
  await page.locator('.physical-shortcuts').getByRole('button', { name: 'Finish action', exact: true }).click();
  const before = wire.states.length;
  await page.getByRole('button', { name: /^End turn/ }).click();
  await expect(page.locator('.turn-banner-text strong')).toHaveText('AI Mage 2');
  await expect(page.locator('.turn-banner .end-turn')).toHaveCount(0);
  await expect.poll(() => wire.states.slice(before).some(s => s.currentPlayerId === 'p2' &&
   s.players[1].wizard.position.q === 0 && s.players[1].wizard.position.r === 0), { timeout: 15_000 }).toBe(true);
  // A real AI command, not the human's handoff, removes access to human history.
  await expect.poll(() => wire.states.slice(before).some(s => s.currentPlayerId === 'p2' &&
   !!s.activation?.physicalAction && !s.history?.canUndo && !s.history?.canRedo)).toBe(true);
  // No human hidden spells were activated, so the bot can finish without a prompt.
  await expect(page.getByRole('button', { name: /^End turn/ })).toBeVisible({ timeout: 20_000 });
  expect(wire.states.slice(before).some(s => s.log.some(line => /AI Mage 2 (casts|activates|moves|begins|explores)/.test(line)))).toBe(true);
  await expect(page.locator('.hex[data-room-id="room-0,0"] [data-mage-id="p2"]')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach(`ai-game-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
 });
}