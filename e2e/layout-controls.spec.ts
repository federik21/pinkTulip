import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { createGame, type Card, type Evocation, type GameAction, type GameState } from '../packages/game-engine/src/index';
import { selectControlTab, viewRetinue } from './layout-ui';

const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
test.afterEach(async ({ page }) => expect(faults.get(page), 'No uncaught browser/React errors').toEqual([]));

function take(game: GameState, name: string): Card {
  const deck = game.library.find(deck => deck.cards.some(card => card.name === name));
  if (!deck) throw new Error(`Missing canonical layout fixture card: ${name}`);
  return deck.cards.splice(deck.cards.findIndex(card => card.name === name), 1)[0];
}
function model(id: string, playerId: string): Evocation {
  return { id, playerId, number: 1, name: 'Cadaver', archetype: 'UNDEAD', movement: 2, attack: 2,
    health: 2, passive: 'WOUNDED_FURY', position: { q: 0, r: 0 }, damageCubes: 0,
    damageByPlayer: {}, activated: false };
}
function fixture(): GameState {
  const game = createGame(2);
  game.gameId = 'layout-controls'; game.round = 1; game.phase = 'ACTION';
  game.currentPlayerId = game.firstPlayerId = 'p1';
  game.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
    spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
  game.players[0].prepared.slot1 = { card: take(game, 'Arcane Bolt'), used: false };
  game.players.forEach((p, index) => {
    p.name = ['Rose Warden', 'Blue Seer'][index]; p.connected = p.ready = true;
    p.wizard.position = { q: 0, r: 0 };
    p.hand.push(...game.library.find(deck => deck.id === 'cantrip')!.cards.splice(0, index + 2));
  });
  game.players[0].quest = game.questDeck.shift()!;
  game.evocations = [model('own-model', 'p1'), model('peer-model', 'p2')];
  // Intentionally UNMASKED foreign cards test defense in depth, not just server projection.
  game.readiedSpells = [
    { id: 'own-trap', playerId: 'p1', card: take(game, 'Threshold Snare'), roomId: 'room-1,0' },
    { id: 'own-protection', playerId: 'p1', card: take(game, 'Thorn Retort'), targetPlayerId: 'p1' },
    { id: 'foreign-protection', playerId: 'p2', card: take(game, 'Mending Ward'), targetPlayerId: 'p2' },
    { id: 'foreign-trap', playerId: 'p2', card: take(game, 'Cinder Seal'), roomId: 'room-0,1' },
  ];
  game.ongoingSpells = [{ id: 'own-ongoing', playerId: 'p1', card: take(game, "Pilgrim's Mark"), targetPlayerId: 'p1' }];
  game.activeSpellOrder = [...game.readiedSpells, ...game.ongoingSpells].map(active => active.id);
  game.history = { canUndo: true, canRedo: true, undoLabel: 'Move a mage', redoLabel: 'Attack' };
  Object.assign(game.players[0].wizard, { damageCubes: 3, damageByPlayer: { p2: 2 }, blackDamage: 1 });
  game.players[1].cubes.onWizard = 2; game.players[1].cubes.available = 23;
  game.log = ['Layout fixture: the Chronicle stays outside every tab.'];
  return game;
}

async function dismissOverlay(page: Page) {
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
}
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
  await expect(page.locator('.app')).toBeVisible(); await dismissOverlay(page);
  return { commands,
    update(state: GameState) { socket.send(JSON.stringify({ type: 'STATE', state })); },
    ack() { socket.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: commands.at(-1)!.requestId })); },
    close() { socket.close({ code: 1000, reason: 'Layout fixture offline' }); },
  };
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const ownActivation = (page: Page) => page.locator('#retinue-p1').getByRole('button', { name: /^Activate Cadaver #1/ });

for (const viewport of [{ width: 1440, height: 1200 }, { width: 390, height: 844 }]) {
  test.describe(`layout controls at ${viewport.width}px`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });

    test('accessible keyboard tabs wrap with arrows/Home/End, stay above the map and leave board/prepared/Chronicle independent', async ({ page }, info) => {
      const game = fixture(), wire = await mount(page, game);
      const tabs = page.getByRole('tablist', { name: 'Lodge controls', exact: true });
      await expect(tabs).toHaveAttribute('aria-orientation', 'horizontal');
      await expect(tabs.getByRole('tab')).toHaveText(['Actions', 'Evocations', 'More']);
      await expect(tab(page, 'Actions')).toHaveAttribute('aria-selected', 'true');
      await tab(page, 'Actions').focus();
      for (const [key, name] of [['ArrowRight', 'Evocations'], ['ArrowRight', 'More'], ['ArrowRight', 'Actions'],
        ['ArrowLeft', 'More'], ['Home', 'Actions'], ['End', 'More'], ['ArrowLeft', 'Evocations']] as const) {
        await page.keyboard.press(key);
        await expect(tab(page, name)).toBeFocused();
        await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
        await expect(tab(page, name)).toHaveAttribute('tabindex', '0');
        await expect(tabs.locator('[aria-selected="false"][tabindex="-1"]')).toHaveCount(2);
        await expect(page.getByRole('tabpanel')).toHaveCount(1);
        await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
        const controls = await tab(page, name).getAttribute('aria-controls');
        await expect(page.getByRole('tabpanel', { name, exact: true })).toHaveAttribute('id', controls!);
        await expect(page.getByRole('tabpanel', { name, exact: true })).toHaveAttribute('aria-labelledby', await tab(page, name).getAttribute('id') as string);
      }
      await page.keyboard.press('Tab');
      await expect(page.getByRole('tabpanel', { name: 'Evocations', exact: true })).toBeFocused();
      await page.locator('.prepared .spell').click();
      await expect(page.locator('.prepared .spell.chosen')).toHaveCount(1);
      for (const name of ['Actions', 'Evocations', 'More'] as const) {
        await selectControlTab(page, name);
        await expect(page.locator('.board-panel')).toBeVisible();
        await expect(page.locator('.prepared .spell.chosen')).toBeVisible();
        await expect(page.getByRole('log')).toContainText(game.log[0]);
        await expect(page.locator('.history-panel')).toBeVisible();
        await expect(page.locator('.control-banner .history-panel')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Undo action', exact: true })).toBeEnabled();
        await expect(page.locator('.control-panel .board-panel, .control-panel .prepared, .control-panel .log-panel, .control-panel .history-panel')).toHaveCount(0);
        const bounds = await page.locator('.control-banner').evaluate(banner => {
          const box = banner.getBoundingClientRect(), map = document.querySelector('.board-panel')!.getBoundingClientRect();
          return { above: box.bottom <= map.top, left: box.left, right: box.right, viewport: innerWidth,
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        expect(bounds.above).toBe(true); expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.viewport); expect(bounds.overflow).toBe(false);
        await expect(page.locator('#retinue-p1')).toBeVisible({ visible: name === 'Evocations' });
        await expect(page.locator('.reference')).toBeVisible({ visible: name === 'More' });
        await expect(page.locator('.quest-panel')).toBeVisible({ visible: name === 'More' });
        await expect(page.locator('.active-spells-panel')).toBeVisible({ visible: name === 'More' });
        await page.locator('.control-banner').screenshot({path:info.outputPath(`controls-${name.toLowerCase()}.png`),animations:'disabled'});
      }
      const more = page.getByRole('tabpanel', { name: 'More', exact: true });
      expect(await more.evaluate(element => element.clientHeight)).toBeLessThanOrEqual(420);
      expect(await more.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      await expect(page.locator('.quest-panel h3')).toHaveText(`◇ ${game.players[0].quest!.name}`);
      await expect(page.locator('.reference')).toContainText('2 actions total per turn.');
      // The board remains keyboard-operable while More is selected, without losing the prepared target.
      const center = page.locator('.hex[data-room-id="room-0,0"]');
      await center.focus(); await page.keyboard.press('Enter');
      await expect(page.locator('.room-detail')).toBeVisible();
      await expect(tab(page, 'More')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.prepared .spell.chosen')).toHaveCount(1);
      expect(wire.commands).toEqual([]);
      await info.attach(`layout-more-${viewport.width}`, { body: await page.locator('.control-banner').screenshot(), contentType: 'image/png' });
      await page.locator('.players-panel').screenshot({path:info.outputPath('mage-summaries.png'),animations:'disabled'});
    });

    test('Evocation auto-selects even on a peer turn; own active controls survive closed mage/opponent disclosures and paid activations return to Actions', async ({ page }) => {
      const game = fixture(), wire = await mount(page, game);
      await selectControlTab(page, 'More');
      const peer = structuredClone(game); peer.phase = 'EVOCATION'; peer.activation = null; peer.currentPlayerId = 'p2';
      wire.update(peer); await expect(page.locator('.phase-track .current span')).toHaveText('Evocation'); await dismissOverlay(page);
      await expect(tab(page, 'Evocations')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.evocation-phase')).toContainText('Blue Seer is controlling their evocations.');
      await expect(page.locator('#retinue-p1')).toBeVisible(); await expect(ownActivation(page)).toBeDisabled();
      await expect(page.locator('#retinue-p2')).toBeHidden();
      await expect(page.locator('.player[open]')).toHaveCount(0);
      const activePeer = structuredClone(peer);
      activePeer.evocationActivation = { playerId: 'p2', evocationId: 'peer-model', movesRemaining: 2, returnToAction: false };
      wire.update(activePeer); await expect(page.locator('.evocation-controls')).toHaveCount(0);
      const own = structuredClone(peer); own.currentPlayerId = 'p1';
      own.evocationActivation = { playerId: 'p1', evocationId: 'own-model', movesRemaining: 2, returnToAction: false };
      await selectControlTab(page, 'More'); wire.update(own);
      await expect(tab(page, 'Evocations')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.evocation-controls')).toContainText('2 movement remaining.');
      await expect(page.locator('.evocation-controls').getByRole('button', { name: /^Cadaver attack Blue Seer/ })).toBeEnabled();
      await viewRetinue(page, 'p1'); await expect(tab(page, 'Evocations')).toBeFocused();
      const summary = page.locator('.player[data-player-id="p1"] summary');
      await summary.focus(); await page.keyboard.press('Space');
      await expect(page.locator('.player[data-player-id="p1"]')).not.toHaveAttribute('open');
      await expect(page.locator('#retinue-p1')).toBeVisible();
      const show = page.getByRole('button', { name: 'Show evocations for Blue Seer (1)', exact: true });
      await expect(show).toHaveAttribute('aria-expanded', 'false'); await show.click();
      await expect(page.locator('#retinue-p2')).toBeVisible();
      await expect(page.locator('#retinue-p2 button')).toHaveCount(0);
      await page.getByRole('button', { name: 'Hide evocations for Blue Seer (1)', exact: true }).click();
      await expect(page.locator('#retinue-p2')).toBeHidden();
      await viewRetinue(page, 'p2'); await expect(tab(page, 'Evocations')).toBeFocused();
      await expect(page.locator('#retinue-p2')).toBeVisible();
      await page.getByRole('button', { name: 'Hide evocations for Blue Seer (1)', exact: true }).click();
      await expect(page.locator('.evocation-controls')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Finish evocation', exact: true })).toBeEnabled();
      wire.update(game); await expect(page.locator('.phase-track .current span')).toHaveText('Action'); await dismissOverlay(page);
      await expect(tab(page, 'Actions')).toHaveAttribute('aria-selected', 'true');
      await selectControlTab(page, 'Evocations'); await ownActivation(page).click();
      await expect.poll(() => wire.commands.length).toBe(1);
      expect(wire.commands[0].action).toEqual({ type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: 'own-model' });
      const paid = structuredClone(game);
      paid.evocationActivation = { playerId: 'p1', evocationId: 'own-model', movesRemaining: 2, returnToAction: true };
      paid.activation!.actionsUsed = 1; paid.players[0].actionTokens = 1;
      wire.update(paid); wire.ack();
      await expect(tab(page, 'Evocations')).toHaveAttribute('aria-selected', 'true');
      await page.getByRole('button', { name: 'Finish evocation', exact: true }).click();
      await expect.poll(() => wire.commands.length).toBe(2);
      expect(wire.commands[1].action).toEqual({ type: 'END_EVOCATION', playerId: 'p1' });
      paid.evocationActivation = null; wire.update(paid); wire.ack();
      await expect(tab(page, 'Actions')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('button', { name: /^Explore/ })).toBeEnabled();
      await expect(page.locator('.board-panel')).toBeVisible();
    });

    test('Actions and history stay in the top banner; pending, peer-disconnected and offline states cannot issue duplicate commands', async ({ page }) => {
      const game = fixture(), wire = await mount(page, game);
      const explore = page.getByRole('button', { name: /^Explore/ });
      await expect(page.locator('.control-banner .actions-panel')).toHaveCount(1);
      await explore.click(); await expect.poll(() => wire.commands.length).toBe(1);
      expect(wire.commands[0].action).toEqual({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
      await expect(explore).toBeDisabled(); await expect(page.locator('.prepared .spell')).toBeDisabled();
      for (const name of ['Evocations', 'More', 'Actions'] as const) {
        await selectControlTab(page, name);
        await expect(page.getByRole('button', { name: 'Undo action', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Redo action', exact: true })).toBeDisabled();
        if (name === 'Evocations') await expect(ownActivation(page)).toBeDisabled();
      }
      await explore.dispatchEvent('click');
      await page.getByRole('button', { name: 'Undo action', exact: true }).dispatchEvent('click');
      expect(wire.commands).toHaveLength(1);
      const physical = structuredClone(game);
      physical.activation!.physicalAction = { kind: 'EXPLORE', mainEffectUsed: false, movementStarted: false };
      physical.activation!.actionsUsed = 1; physical.players[0].actionTokens = 1;
      wire.update(physical); wire.ack();
      await expect(page.getByRole('button', { name: /^Perform 2 movements/ })).toBeEnabled();
      await selectControlTab(page, 'More'); await selectControlTab(page, 'Actions');
      await expect(page.locator('.physical-effects')).toHaveAttribute('data-physical-kind', 'EXPLORE');
      await expect(page.getByRole('button', { name: 'Skip remaining effects', exact: true })).toBeEnabled();
      const disconnected = structuredClone(game); disconnected.players[1].connected = false;
      wire.update(disconnected);
      await expect(page.getByText(/Game paused\. Waiting for the disconnected mage/)).toBeVisible();
      await expect(page.locator('.actions-panel button:enabled, .prepared .spell:enabled')).toHaveCount(0);
      await selectControlTab(page, 'Evocations'); await expect(ownActivation(page)).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Undo action', exact: true })).toBeDisabled();
      wire.update(game); await selectControlTab(page, 'Actions'); await expect(explore).toBeEnabled();
      const peerTurn = structuredClone(game); peerTurn.currentPlayerId = 'p2'; peerTurn.activation!.playerId = 'p2';
      wire.update(peerTurn); await expect(page.locator('.control-waiting')).toContainText('Blue Seer is acting.');
      await expect(page.getByRole('button', { name: 'Undo action', exact: true })).toBeEnabled();
      wire.update(game); await expect(explore).toBeEnabled();
      wire.close(); await expect(page.locator('.header-meta')).toContainText('Offline');
      await expect(page.locator('.actions-panel button:enabled, .prepared .spell:enabled')).toHaveCount(0);
      await selectControlTab(page, 'Evocations'); await expect(ownActivation(page)).toBeDisabled();
      for (const name of ['More', 'Actions'] as const) {
        await selectControlTab(page, name);
        await expect(page.getByRole('button', { name: 'Undo action', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Redo action', exact: true })).toBeDisabled();
      }
      expect(wire.commands).toHaveLength(1);
      await expect(page.getByRole('alert')).toContainText('Connection closed.');
    });

    test('closed compact rosters expose cards/damage/tokens and own Trap/Protection types, but foreign unmasked cards reveal only hidden counts', async ({ page }) => {
      const game = fixture(), wire = await mount(page, game);
      await expect(page.locator('.player')).toHaveCount(2); await expect(page.locator('.player[open]')).toHaveCount(0);
      for (const p of game.players) {
        const mage = page.locator(`.player[data-player-id="${p.id}"]`), summary = mage.locator('summary');
        await expect(summary.locator('.critical-attributes dt')).toHaveText('Cards');
        await expect(summary.locator('.critical-attributes dd')).toHaveText(`${p.hand.length}/7`);
        await expect(summary.locator('.player-stats')).toHaveText('⚡ 2 tokens');
        await expect(summary.getByRole('meter')).toBeVisible();
        await expect(summary.getByRole('meter')).toHaveAttribute('aria-valuenow', String(p.wizard.damageCubes));
        await expect(mage.locator('.mage-secondary')).toBeHidden();
        await expect(mage.locator('.secondary-attributes, .cube-pool, [title="Available cubes"]')).toHaveCount(3);
        await expect(summary.locator('.active-magic-counts')).toHaveText(p.id === 'p1' ? 'Trap: 1 · Protection: 1' : 'Hidden active: 2');
        if (p.id === 'p2') {
          const markup = await mage.evaluate(element => element.outerHTML);
          expect(markup).not.toMatch(/Trap|Protection|spell-type|data-spell-type|Mending Ward|Cinder Seal|BOUND_MODEL|DAMAGE_TAKEN/);
          for (const active of game.readiedSpells!.filter(active => active.playerId === p.id)) {
            for (const secret of [active.card.id, active.card.name, active.card.rulesText!]) expect(markup).not.toContain(secret);
          }
        }
        await summary.focus(); await page.keyboard.press('Enter');
        await expect(mage).toHaveAttribute('open', '');
        await expect(mage.locator('.secondary-attributes dt')).toHaveText(['Max HP', 'Attack', 'Movement', 'Quest limit']);
        await expect(mage.locator('.secondary-attributes dd')).toHaveText(['10', '2', '2', '2']);
        await expect(mage.locator('[title="Available cubes"]')).toHaveText(`◆ ${p.cubes.available} available`);
        await expect(mage.locator('.cube-pool')).toContainText(`On mages: ${p.cubes.onWizard}`);
        await page.keyboard.press('Space'); await expect(mage).not.toHaveAttribute('open');
      }
      await selectControlTab(page, 'More');
      await expect(page.locator('.own-spell strong')).toHaveText(['Threshold Snare', 'Thorn Retort']);
      await expect(page.locator('.hidden-spell strong')).toHaveText(['Hidden active spell', 'Hidden active spell']);
      await expect(page.locator('.hidden-spell [data-spell-type], .hidden-spell [role="img"]')).toHaveCount(0);
      const foreignMarkup = await page.locator('.hidden-spell').evaluateAll(elements => elements.map(element => element.outerHTML).join('\n'));
      for (const active of game.readiedSpells!.filter(active => active.playerId === 'p2')) {
        for (const secret of [active.card.id, active.card.name, active.card.rulesText!]) expect(foreignMarkup).not.toContain(secret);
      }
      const changed = structuredClone(game);
      changed.readiedSpells = changed.readiedSpells!.filter(active => active.id !== 'foreign-trap' && active.id !== 'own-trap');
      changed.players[1].hand.pop(); changed.players[1].actionTokens = 1; wire.update(changed);
      await expect(page.getByLabel('Rose Warden active magic', { exact: true })).toHaveText('Trap: 0 · Protection: 1');
      await expect(page.getByLabel('Blue Seer active magic', { exact: true })).toHaveText('Hidden active: 1');
      await expect(page.locator('.player[data-player-id="p2"] summary .critical-attributes dd')).toHaveText('2/7');
      await expect(page.locator('.player[data-player-id="p2"] summary .player-stats')).toHaveText('⚡ 1 tokens');
      await expect(page.locator('.player[open]')).toHaveCount(0); expect(wire.commands).toEqual([]);
    });
  });
}