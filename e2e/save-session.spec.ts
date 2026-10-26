import { test, expect, type Page } from '@playwright/test';
import { createGame, type GameState } from '../packages/game-engine/src/index';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = []; errors.set(page, list);
  page.on('pageerror', error => list.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

function runningGame(): GameState {
  const game = createGame(2);
  game.gameId = 'resume-me'; game.round = 1; game.phase = 'ACTION';
  game.firstPlayerId = 'p1'; game.currentPlayerId = 'p2';
  game.players.forEach((player, index) => { player.name = ['Ayla', 'Borin'][index]; player.connected = player.ready = true; });
  return game;
}

async function mountServer(page: Page, options: { canSave: boolean; rooms?: unknown[] }) {
  const saves: unknown[] = [];
  await page.routeWebSocket('**', route => {
    route.send(JSON.stringify({ type: 'CONNECTED', canSave: options.canSave }));
    route.send(JSON.stringify({ type: 'ROOM_LIST', rooms: options.rooms ?? [] }));
    route.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: message.roomId }));
        route.send(JSON.stringify({ type: 'STATE', state: publicState(runningGame(), 'p1', new ActionHistory()) }));
      } else if (message.type === 'SAVE_SESSION') {
        saves.push(message);
        route.send(JSON.stringify({ type: 'SESSION_SAVED', roomId: 'resume-me', savedAt: new Date().toISOString() }));
      }
    });
  });
  await page.goto('/');
  return saves;
}

test('a running battle offers Save session, which asks the server to save and confirms it', async ({ page }) => {
  const saves = await mountServer(page, { canSave: true });
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save session', exact: true });
  await expect(save).toBeVisible();
  await save.click();
  await expect.poll(() => saves.length).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'Session saved' })).toContainText('Rejoin room "resume-me" with your mage name');
});

test('Save session is hidden when the server has saving turned off', async ({ page }) => {
  await mountServer(page, { canSave: false });
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Quick reference', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save session', exact: true })).toHaveCount(0);
});

test('saved battles are listed with their mage names and can be selected to resume', async ({ page }) => {
  await mountServer(page, { canSave: true, rooms: [{ id: 'resume-me', players: 2, capacity: 4, status: 'saved', mages: ['Ayla', 'Borin'] }] });
  const entry = page.locator('.room-list').getByRole('button', { name: /resume-me/ });
  await expect(entry).toContainText('2/4 · saved: Ayla, Borin');
  await entry.click();
  await expect(page.getByLabel('Room name')).toHaveValue('resume-me');
});
