import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { createGame, summonEvocation, type GameAction, type GameState, type PendingDecision } from '../packages/game-engine/src/index';
import { selectControlTab } from './layout-ui';

const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
test.afterEach(async ({ page }) => expect(faults.get(page), 'No uncaught browser/React errors').toEqual([]));
test.use({ viewport: { width: 1440, height: 1200 }, reducedMotion: 'reduce' });

function fixture(): GameState {
  const game = createGame(2);
  game.gameId = 'soul-tithe'; game.round = 1; game.phase = 'ACTION';
  game.currentPlayerId = game.firstPlayerId = 'p1';
  game.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
    spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
  game.players.forEach((p, i) => { p.name = ['Rose Warden', 'Blue Seer'][i]; p.connected = p.ready = true; p.wizard.position = { q: 0, r: 0 }; });
  summonEvocation(game, game.players[0], 'SUCCUBUS', { q: 0, r: 0 })!.id = 'succ';
  summonEvocation(game, game.players[1], 'CADAVER', { q: 0, r: 0 })!.id = 'cadaver';
  return game;
}
const decision = (playerId: string): Extract<PendingDecision, { kind: 'SOUL_TITHE' }> => ({ kind: 'SOUL_TITHE', playerId, key: 'k', evocationId: 'succ',
  evocationName: 'Succubus #1', evocationWounds: 1, evocationHealth: 3, targetId: 'p1', targetName: 'Rose Warden',
  sourceName: 'Blue Seer', amount: 2 });

async function mount(page: Page, game: GameState) {
  let socket: WebSocketRoute;
  const commands: { action: GameAction; requestId: string }[] = [];
  await page.routeWebSocket('**', route => {
    socket = route;
    route.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: game.gameId }));
        route.send(JSON.stringify({ type: 'STATE', state: game }));
      } else if (message.action) commands.push(message);
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.locator('.app')).toBeVisible();
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
  return { commands,
    update(state: GameState) { socket.send(JSON.stringify({ type: 'STATE', state })); },
    ack() { socket.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: commands.at(-1)!.requestId })); } };
}

test('a Succubus shows its Demon stats and an Auto switch that only its owner can flip', async ({ page }) => {
  const game = fixture(), wire = await mount(page, game);
  await selectControlTab(page, 'Evocations');
  const card = page.locator('#retinue-p1 .evocation-card[data-evocation-id="succ"]');
  await expect(card).toContainText('Succubus');
  await expect(card).toContainText('Demon');
  await expect(card).toContainText('2 movement');
  await expect(card).toContainText('1 attack');
  await expect(card).toContainText('Soul Tithe');
  const auto = card.getByRole('switch', { name: 'Auto Soul Tithe for Succubus #1' });
  await expect(auto).not.toBeChecked();
  await auto.click();
  expect(wire.commands.at(-1)!.action).toEqual({ type: 'SET_EVOCATION_AUTO', playerId: 'p1', evocationId: 'succ', auto: true });
  wire.ack();
  game.evocations[0].autoAbility = true; wire.update(game);
  await expect(auto).toBeChecked();
  await expect(card).toContainText('without asking');
});

test('the owner must answer the prompt: Escape keeps it open and both answers are sent', async ({ page }) => {
  const game = fixture(), wire = await mount(page, game);
  game.pendingDecision = decision('p1'); wire.update(game);
  const dialog = page.getByRole('dialog', { name: 'Let Succubus #1 take a damage cube?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Blue Seer deals 2 damage to Rose Warden');
  await expect(dialog).toContainText('1/3 damage');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
  expect(wire.commands.at(-1)!.action).toEqual({ type: 'RESPOND_SOUL_TITHE', playerId: 'p1', accept: false });
  wire.ack();
  game.pendingDecision = { ...decision('p1'), key: 'k2' }; wire.update(game);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Take a cube', exact: true }).click();
  expect(wire.commands.at(-1)!.action).toEqual({ type: 'RESPOND_SOUL_TITHE', playerId: 'p1', accept: true });
  wire.ack();
  delete game.pendingDecision; wire.update(game);
  await expect(page.getByRole('dialog', { name: /take a damage cube/ })).toHaveCount(0);
});

test('other mages see a waiting notice instead of the prompt and cannot act meanwhile', async ({ page }) => {
  const game = fixture(), wire = await mount(page, game);
  game.pendingDecision = { ...decision('p2'), evocationName: 'Succubus #1' }; wire.update(game);
  await expect(page.getByRole('status').filter({ hasText: 'Waiting for Blue Seer to decide whether Succubus #1 takes a damage cube' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /take a damage cube/ })).toHaveCount(0);
  await selectControlTab(page, 'Evocations');
  await expect(page.locator('#retinue-p1').getByRole('switch')).toBeDisabled();
});
