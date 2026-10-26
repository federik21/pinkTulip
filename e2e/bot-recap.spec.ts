import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { createGame, moment, type Card, type GameState, type GameFeedbackEvent, type TurnRecap } from '../packages/game-engine/src/index';

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
  game.gameId = 'bot-recap'; game.round = 1; game.phase = 'ACTION';
  game.currentPlayerId = game.firstPlayerId = 'p1';
  game.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
    spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
  game.players.forEach((p, i) => { p.name = ['Rose Warden', 'Blue Seer'][i]; p.connected = p.ready = true; p.wizard.position = { q: 0, r: 0 }; });
  game.players[1].isBot = true;
  return game;
}

async function mount(page: Page, game: GameState) {
  let socket: WebSocketRoute;
  await page.routeWebSocket('**', route => {
    socket = route;
    route.onMessage(data => {
      if (JSON.parse(String(data)).type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: game.gameId }));
        route.send(JSON.stringify({ type: 'STATE', state: game }));
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.locator('.app')).toBeVisible();
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
  return { update(state: GameState) { socket.send(JSON.stringify({ type: 'STATE', state })); } };
}

const bolt: Card = { id: 'bolt', name: 'Grim Bolt', kind: 'SPELL', target: 'MAGE', range: 2, moments: [moment.damage(2)] };
const ward: Card = { id: 'ward', name: 'Mending Ward', kind: 'SPELL', spellType: 'PROTECTION', target: 'SELF', range: 0, moments: [moment.heal(1)],
  trigger: { event: 'DAMAGE_TAKEN', relation: 'ENEMY', scope: 'BOUND_MODEL' } };
const recap = (): TurnRecap => ({ id: '1:p2:0', round: 1, playerId: 'p2', playerName: 'Blue Seer', isBot: true,
  lines: ['Blue Seer starts their turn: 2 actions.', 'Blue Seer casts Grim Bolt for 1 action (no physical token).',
    'Interrupt DAMAGE_TAKEN: Rose Warden reveals Mending Ward.', 'Blue Seer ends their turn.'],
  cards: [{ at: 2, role: 'CAST', ownerId: 'p2', card: bolt }, { at: 3, role: 'TRIGGERED', ownerId: 'p1', card: ward, trigger: 'DAMAGE_TAKEN' }] });

test('the last bot turn is recapped in order with the full cast and triggered cards', async ({ page }) => {
  const game = fixture(), wire = await mount(page, game);
  await expect(page.getByRole('region', { name: 'Last bot turn recap' })).toHaveCount(0);
  game.turnRecaps = [recap()]; wire.update(game);
  const panel = page.getByRole('region', { name: 'Last bot turn recap' });
  await expect(panel).toBeVisible();
  const steps = panel.getByRole('list', { name: "Blue Seer's turn, in order" }).getByRole('listitem');
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(1)).toContainText('casts Grim Bolt');
  await expect(steps.nth(1).locator('.recap-card[data-recap-role="CAST"]')).toContainText('Grim Bolt');
  await expect(steps.nth(2)).toContainText('reveals Mending Ward');
  const triggered = steps.nth(2).locator('.recap-card[data-recap-role="TRIGGERED"]');
  await expect(triggered).toContainText('Mending Ward');
  await expect(triggered).toContainText('Rose Warden');
  await expect(panel.locator('.recap-card')).toHaveCount(2);
  await panel.getByRole('button', { name: /Last bot turn/ }).click();
  await expect(steps).toHaveCount(0);
});

test('a recap already present on join stays collapsed', async ({ page }) => {
  const game = fixture(); game.turnRecaps = [recap()];
  await mount(page, game);
  const toggle = page.getByRole('button', { name: /Last bot turn/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.locator('.turn-recap-steps li')).toHaveCount(4);
});

test('damage and conversion numbers are tinted by who dealt them', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-24T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-24T12:00:01Z'));
  const game = fixture(), wire = await mount(page, game);
  const roomId = game.board.rooms.find(room => room.tiles.some(tile => tile.q === 0 && tile.r === 0))!.id;
  const target = { kind: 'MAGE' as const, id: 'p1', name: 'Rose Warden', roomId };
  const feedback: GameFeedbackEvent[] = [
    { id: 'by-p2', round: 1, kind: 'DAMAGE', target, sourceId: 'p2', amount: 1 },
    { id: 'by-p1', round: 1, kind: 'CONVERT', target, sourceId: 'p1', amount: 1, total: 1 },
  ];
  game.feedbackEvents = feedback; wire.update(game);
  const damage = page.locator('.feedback-pulse[data-event-id="by-p2"]').first();
  const convert = page.locator('.feedback-pulse[data-event-id="by-p1"]').first();
  await expect(damage).toHaveAttribute('data-source-id', 'p2');
  await expect(convert).toHaveAttribute('data-source-id', 'p1');
  const color = (locator: typeof damage) => locator.evaluate(node => getComputedStyle(node).color);
  const [dealt, converted] = [await color(damage), await color(convert)];
  expect(dealt).not.toBe(converted);
  // Neither keeps the old kind-only default (#ffc0b9 / #ddc8ff).
  expect(dealt).not.toBe('rgb(255, 192, 185)');
  expect(converted).not.toBe('rgb(221, 200, 255)');
});
