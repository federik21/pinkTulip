import { test, expect, type Page } from '@playwright/test';
import { applyAction, createGame, type Card, type GameAction, type GameState } from '../packages/game-engine/src/index';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { closeQuickReference, openQuickReference, selectControlTab, selectSpells } from './layout-ui';
import { expectSchoolIcon } from './spell-ui';

const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
test.afterEach(async ({ page }) => expect(faults.get(page), 'No uncaught browser/React errors').toEqual([]));

function fixture(phase: GameState['phase'] = 'STUDY'): GameState {
  const game = createGame(2);
  game.gameId = 'lodge-revision'; game.round = 2; game.phase = phase;
  game.players.forEach((p, index) => {
    p.name = ['Rose Warden', 'Blue Seer'][index]; p.connected = p.ready = true;
    p.wizard.position = { q: index, r: 0 };
  });
  return game;
}
function take(game: GameState, name: string): Card {
  const deck = game.library.find(deck => deck.cards.some(card => card.name === name));
  if (!deck) throw new Error(`Missing canonical revision card: ${name}`);
  return deck.cards.splice(deck.cards.findIndex(card => card.name === name), 1)[0];
}
function physicalIds(game: GameState) {
  return [...game.library.flatMap(deck => [...deck.cards, ...deck.discard]), ...game.powerfulDeck, ...game.removedCards,
    ...[...game.readiedSpells ?? [], ...game.ongoingSpells ?? []].map(active => active.card),
    ...game.players.flatMap(p => [...p.hand, ...p.personalDeck, ...p.discard,
      ...Object.values(p.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])].map(card => card.id).sort();
}
async function dismissOverlay(page: Page) {
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
}
async function mount(page: Page, initial: GameState, viewer = 'p1') {
  let game = structuredClone(initial), publish = () => {};
  const commands: GameAction[] = [], history = new ActionHistory(), originalIds = physicalIds(game);
  expect(originalIds).toHaveLength(120); expect(new Set(originalIds).size).toBe(120);
  await page.routeWebSocket('**', route => {
    publish = () => route.send(JSON.stringify({ type: 'STATE', state: publicState(game, viewer, history) }));
    route.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: viewer, roomId: game.gameId })); publish();
      } else if (message.action) {
        try {
          expect(message.action.playerId).toBe(viewer);
          game = applyAction(game, message.action); commands.push(message.action);
          expect(physicalIds(game)).toEqual(originalIds); publish();
          route.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: message.requestId }));
        } catch (error) {
          faults.get(page)!.push(String(error));
          route.send(JSON.stringify({ type: 'ERROR', requestId: message.requestId, message: String(error) }));
        }
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.locator('.app')).toBeVisible(); await dismissOverlay(page);
  return { commands, get state() { return game; }, update(state: GameState) {
    expect(physicalIds(state)).toEqual(originalIds); game = structuredClone(state); publish();
  } };
}

for (const viewport of [{ width: 1440, height: 1200 }, { width: 390, height: 844 }]) {
  test.describe(`lodge revision at ${viewport.width}px`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });

    test('header reference and board information are named modal dialogs with Escape/Close focus return, not control tabs', async ({ page }) => {
      const game = fixture('ACTION'); game.currentPlayerId = game.firstPlayerId = 'p1';
      game.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
        spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
      game.players[0].prepared.slot1 = { card: take(game, 'Arcane Bolt'), used: false };
      game.players[0].hand.push(game.powerfulDeck.pop()!);
      const wire = await mount(page, game);
      await expect(page.getByRole('tablist', { name: 'Lodge controls', exact: true }).getByRole('tab'))
        .toHaveText(['Physical actions', 'Spells', 'Evocations', 'Quests']);
      await expect(page.locator('header').getByRole('button', { name: 'Quick reference', exact: true })).toBeVisible();
      await expect(page.locator('.board-panel').getByRole('button', { name: 'Lodge information', exact: true })).toBeVisible();
      await expect(page.locator('.board-panel .room-legend, .board-panel .mage-legend')).toHaveCount(0);
      await expect(page.getByRole('tab', { name: /More|Quick reference/ })).toHaveCount(0);
      await selectSpells(page); await page.locator('.prepared .spell').click();
      await expect(page.locator('#controls-panel-spells .powerful-panel')).toBeVisible();
      await expect(page.locator('.reference')).toBeHidden();
      for (const name of ['Quick reference', 'Lodge information'] as const) {
        const opener = page.getByRole('button', { name, exact: true });
        for (const method of ['Escape', 'Close'] as const) {
          await opener.click();
          const dialog = page.getByRole('dialog', { name, exact: true });
          await expect(dialog).toBeVisible();
          await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
          if (name === 'Quick reference') {
            await expect(dialog.locator('.reference')).toContainText('2 actions total per turn.');
            await expect(dialog.locator('.reference')).toContainText('Forgotten spells:');
            await expect(dialog.locator('.room-legend, .mage-legend')).toHaveCount(0);
          } else {
            await expect(dialog.locator('.room-legend')).toBeVisible();
            await expect(dialog.locator('.mage-legend')).toBeVisible();
            await expect(dialog.locator('.mage-legend [data-player-id]')).toHaveCount(2);
            for (const p of game.players) {
              await expect(dialog.locator(`.mage-legend [data-player-id="${p.id}"]`)).toContainText(p.name);
            }
            await expect(dialog.locator('.mage-legend')).toContainText('(not) Black Rose · neutral');
            // Neither legend is duplicated elsewhere while the popup is open.
            await expect(page.locator('.room-legend')).toHaveCount(1);
            await expect(page.locator('.mage-legend')).toHaveCount(1);
            await expect(dialog).toContainText(/Crimson/i);
            await expect(dialog).toContainText(/Grey/i);
            await expect(dialog).toContainText(/Cadaver/i);
            await expect(dialog).toContainText(/Forgotten/i);
            await expect(dialog).toContainText(/Scroll/i);
            await expect(dialog).toContainText(/starting/i);
            await expect(dialog).toContainText(/instability/i);
          }
          // Keyboard focus cannot escape a modal into live game commands.
          await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
          await page.keyboard.press('Tab');
          await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
          await page.keyboard.press('Shift+Tab');
          await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
          if (method === 'Escape') await page.keyboard.press('Escape');
          else await dialog.getByRole('button', { name: 'Close', exact: true }).click();
          await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
          await expect(page.getByRole('tab', { name: 'Spells', exact: true })).toHaveAttribute('aria-selected', 'true');
          await expect(page.locator('.prepared .spell.chosen')).toBeVisible();
        }
      }
      // Both legends and detailed help belong only to Lodge information.
      await expect(page.locator('.board-panel .room-legend, .board-panel .mage-legend')).toHaveCount(0);
      await expect(page.locator('.board-panel .board-help')).toBeHidden();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(wire.commands).toEqual([]);
    });

    test('mixed blind Study selection supports repetition, remove/reset, limited supplies and only the four new eligible cards', async ({ page }) => {
      const game = fixture(), me = game.players[0];
      // Reserve deterministic copies before allocating old/personal cards.
      const draws = ['Arcane Bolt', 'Stolen Sigil', 'Threshold Snare', 'Ember Lance'].map(name => take(game, name));
      for (const card of [...draws].reverse()) game.library.find(deck => deck.id === card.schoolId)!.cards.unshift(card);
      const old = take(game, 'Mending Light'), personal = [take(game, 'Mending Ward'), take(game, 'Thorn Retort')];
      me.hand.push(old, ...personal);
      const enchantment = game.library.find(deck => deck.id === 'enchantment')!;
      game.players[1].hand.push(...enchantment.cards.splice(1)); // Exactly one available, not four.
      const beforeHand = [...me.hand], wire = await mount(page, game);
      const phase = page.locator('.phase-panel'), confirm = phase.getByRole('button', { name: /^Draw selected cards/ });
      const tile = (id: string) => phase.locator(`.schools button[data-school-id="${id}"]`);
      const selected = ['cantrip', 'transmutation', 'enchantment', 'cantrip'];
      await expect(phase.locator('.spell')).toHaveCount(0); // Blind means no card preview.
      for (const [id, label, glyph] of [['cantrip', 'Cantrip school', '✺'], ['transmutation', 'Transmutation school', '⚗'], ['enchantment', 'Enchantment school', '⌘']]) {
        await expectSchoolIcon(tile(id), { id, label, glyph });
      }
      await expect(tile('enchantment')).toBeEnabled(); await tile('enchantment').click();
      await expect(tile('enchantment')).toBeDisabled(); await expect(confirm).toBeDisabled();
      await phase.getByRole('button', { name: 'Remove 1 Enchantment card', exact: true }).click();
      await expect(tile('enchantment')).toBeEnabled();
      await tile('cantrip').click(); await tile('transmutation').click();
      await phase.getByRole('button', { name: 'Reset selection', exact: true }).click();
      await expect(confirm).toBeDisabled();
      await expect(phase.getByRole('button', { name: /^Remove 1 / })).toHaveCount(0);
      for (const [index, id] of selected.entries()) {
        await tile(id).click();
        if (index < 3) await expect(confirm).toBeDisabled();
        expect(wire.commands).toEqual([]);
      }
      await expect(tile('cantrip')).toBeDisabled(); await expect(confirm).toBeEnabled();
      await phase.getByRole('button', { name: 'Remove 1 Cantrip card', exact: true }).click();
      await expect(confirm).toBeDisabled();
      // Removal need not define which repeated entry it removes. Rebuild the
      // explicit order before asserting the actual request and draw order.
      await phase.getByRole('button', { name: 'Reset selection', exact: true }).click();
      for (const id of selected) await tile(id).click();
      await confirm.click(); await expect.poll(() => wire.commands.length).toBe(1);
      expect(wire.commands[0]).toEqual({ type: 'DRAW_STUDY', playerId: 'p1', deckIds: selected });
      const after = wire.state.players[0], eligible = after.studyCardIds!;
      expect(eligible).toEqual(draws.map(card => card.id));
      expect(after.hand).toEqual([...beforeHand, ...draws]);
      const cards = phase.locator('.spell'); await expect(cards).toHaveCount(7);
      await expect(phase.locator('.spell:enabled')).toHaveCount(4);
      await expect(phase.locator('.spell:disabled')).toHaveCount(3);
      for (let index = 0; index < beforeHand.length; index++) {
        await expect(cards.nth(index)).toBeDisabled();
        await cards.nth(index).dispatchEvent('click');
      }
      await expect(phase.locator('.spell.chosen')).toHaveCount(0);
      await cards.nth(3).click(); await cards.nth(4).click();
      await phase.getByRole('button', { name: 'Discard selected (2/2)', exact: true }).click();
      await expect.poll(() => wire.commands.length).toBe(2);
      expect(wire.commands[1]).toEqual({ type: 'DISCARD_STUDY', playerId: 'p1', cardIds: eligible.slice(0, 2) });
      expect(wire.state.players[0].hand.slice(0, 3)).toEqual(beforeHand);
      expect(wire.state.library.find(deck => deck.id === 'cantrip')!.discard).toEqual([draws[0]]);
      expect(wire.state.library.find(deck => deck.id === 'transmutation')!.discard).toEqual([draws[1]]);
      expect(publicState(wire.state, 'p1', new ActionHistory()).players[0].studyCardIds).toEqual(eligible);
      for (const viewer of ['p2', null]) {
        const projected = publicState(wire.state, viewer, new ActionHistory());
        expect(projected.players[0]).not.toHaveProperty('studyCardIds');
        for (const id of eligible) expect(JSON.stringify(projected.players[0])).not.toContain(id);
      }
      await expect(page.getByText('✓ Study complete. Waiting for the other mages.', { exact: true })).toBeVisible();
    });

    for (const count of [2, 3]) {
      test(`Preparation accepts ${count} ordered spells without a flexible slot and leaves every unselected card in hand`, async ({ page }) => {
        const game = fixture('PREPARATION');
        game.players[0].hand.push(...['Arcane Bolt', 'Mending Light', 'Stolen Sigil', 'Threshold Snare', 'Thorn Retort'].map(name => take(game, name)));
        game.players[1].hand.push(take(game, 'Renewing Word'), take(game, "Mage's Due"));
        const peerPrepared = applyAction(game, { type: 'PREPARE_CARDS', playerId: 'p2',
          preparedCardIds: game.players[1].hand.map(card => card.id) });
        const hand = [...game.players[0].hand], wire = await mount(page, peerPrepared);
        const panel = page.locator('.phase-panel'), cards = panel.locator('.spell');
        await expect(panel.getByRole('heading', { name: 'Prepare 2–4 spells', exact: true })).toBeVisible();
        await expect(page.locator('.control-banner .phase-panel')).toHaveCount(0);
        const confirm = panel.getByRole('button', { name: 'Prepare spells', exact: true });
        await expect(confirm).toBeDisabled(); await cards.nth(0).click(); await expect(confirm).toBeDisabled();
        await cards.nth(1).click(); await expect(confirm).toBeEnabled();
        await panel.getByRole('button', { name: 'Reset selection', exact: true }).click();
        await expect(panel.locator('.spell.chosen')).toHaveCount(0); await expect(confirm).toBeDisabled();
        for (let index = 0; index < count; index++) await cards.nth(index).click();
        await confirm.click(); await expect.poll(() => wire.commands.length).toBe(1);
        expect(wire.commands[0]).toEqual({ type: 'PREPARE_CARDS', playerId: 'p1', preparedCardIds: hand.slice(0, count).map(card => card.id) });
        await expect(page.locator('.phase-track .current span')).toHaveText('Action'); await dismissOverlay(page);
        await expect(page.getByRole('tab', { name: 'Physical actions', exact: true })).toHaveAttribute('aria-selected', 'true');
        const own = wire.state.players[0]; expect(own.prepared.rapid).toBeNull();
        expect(own.hand).toEqual(hand.slice(count));
        for (const [index, slot] of (['slot1', 'slot2', 'slot3'] as const).entries()) {
          expect(own.prepared[slot]).toEqual(index < count ? { card: hand[index], used: false } : null);
        }
        await expect(page.getByLabel('Rose Warden spells remaining', { exact: true })).toHaveText(`Spells left: ${count}`);
        await selectSpells(page);
        await expect(page.locator('#controls-panel-spells .prepared .spell')).toHaveCount(count);
        await expect(page.locator('.prepared .spell .eyebrow')).toHaveText(hand.slice(0, count).map((card, index) =>
          `Spell ${index + 1} · ${card.target === 'SELF' ? 'Self' : card.target === 'MODEL' ? 'Model' : card.target === 'ROOM' ? 'Room' : 'Mage'}`));
      });
    }

    test('only the host changes room counts, including automatic reset, using the exact wire action', async ({ page }) => {
      const game = fixture('LOBBY'); game.round = 0;
      const wire = await mount(page, game), select = page.getByRole('combobox', { name: 'Rooms per color', exact: true });
      await expect(select).toBeEnabled(); await expect(select).toHaveValue('auto');
      expect(await select.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
        .toEqual(['auto', '1', '2', '3']);
      for (const [index, value] of ['1', '2', '3', 'auto'].entries()) {
        await select.selectOption(value); await expect.poll(() => wire.commands.length).toBe(index + 1);
        expect(wire.commands[index]).toEqual({ type: 'SET_ROOM_COUNT', playerId: 'p1', roomsPerColor: value === 'auto' ? null : Number(value) });
        await expect(select).toHaveValue(value);
        expect(wire.state.players.every(p => !p.ready)).toBe(true);
      }
      const changedHost = structuredClone(wire.state); changedHost.hostId = 'p2'; wire.update(changedHost);
      await expect(select).toBeDisabled();
      expect(wire.commands).toHaveLength(4);
    });

    test('Cleanup returns untriggered hidden cards privately and discards ongoing cards publicly without losing physical IDs', async ({ page }) => {
      const game = fixture('ACTION'), trap = take(game, 'Threshold Snare'), ongoing = take(game, "Pilgrim's Mark");
      game.currentPlayerId = game.firstPlayerId = 'p1';
      game.players.forEach(p => { p.actionTokens = 0; });
      game.activation = { playerId: 'p1', actionsUsed: 1, exploring: 0, sequencedSpellUsed: false,
        spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
      game.readiedSpells = [{ id: 'cleanup-hidden', playerId: 'p1', card: trap, roomId: 'room-1,0' }];
      game.ongoingSpells = [{ id: 'cleanup-ongoing', playerId: 'p2', card: ongoing, targetPlayerId: 'p2' }];
      game.activeSpellOrder = ['cleanup-hidden', 'cleanup-ongoing'];
      const wire = await mount(page, game);
      await selectSpells(page); await expect(page.locator('.own-spell strong')).toHaveText(trap.name);
      await expect(page.locator('.ongoing-spell strong')).toHaveText(ongoing.name);
      await expect(page.locator('.board .model-effect-markers[data-model-id="p1"]')).toHaveCount(0);
      await expect(page.locator('.board .model-effect-markers[data-model-id="p2"] .model-effect[data-effect-kind="ONGOING"]'))
        .toHaveAttribute('data-effect-count', '1');
      await expect(page.locator('.player[data-player-id="p2"] .model-effects .model-effect[data-effect-kind="ONGOING"]'))
        .toHaveAttribute('data-effect-count', '1');
      await selectControlTab(page, 'Physical actions');
      await page.getByRole('button', { name: /^End turn/ }).click();
      await expect(page.locator('.phase-track .current span')).toHaveText('Cleanup'); await dismissOverlay(page);
      expect(wire.state.players[0].hand).toEqual([trap]);
      expect(wire.state.readiedSpells).toEqual([]); expect(wire.state.ongoingSpells).toEqual([]);
      expect(wire.state.activeSpellOrder).toEqual([]);
      await expect(page.locator('.board .model-effect-markers, .model-effects .model-effect')).toHaveCount(0);
      expect(wire.state.library.find(deck => deck.id === 'enchantment')!.discard).toEqual([ongoing]);
      for (const viewer of ['p2', null]) {
        const peer = publicState(wire.state, viewer, new ActionHistory());
        expect(peer.players[0].hand[0].name).toBe('Hidden spell');
        expect(JSON.stringify(peer)).not.toContain(trap.id); expect(JSON.stringify(peer)).not.toContain(trap.name);
      }
      await selectSpells(page); await expect(page.getByRole('region', { name: 'Active and ongoing spells', exact: true })).toHaveCount(0);
      await openQuickReference(page); await expect(page.locator('.reference')).toContainText('Hand 1/7'); await closeQuickReference(page);
      expect(wire.state.feedbackEvents?.filter(event => event.kind === 'SPELL_TRIGGERED') ?? []).toEqual([]);
      await page.getByRole('button', { name: /^Begin round 3/ }).click();
      await expect(page.locator('.phase-track .current span')).toHaveText('(not) Black Rose'); await dismissOverlay(page);
      expect(wire.commands).toEqual([
        { type: 'END_ACTIVATION', playerId: 'p1' },
        { type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'CLEANUP', expectedRound: 2 },
      ]);
      expect(wire.state.players[0].hand).toEqual([trap]);
      expect(wire.state.library.find(deck => deck.id === 'enchantment')!.discard).toEqual([ongoing]);
    });
  });
}

// Genuine sockets and server START_GAME: no injected board, actions or state.
const realBoards: { count: number; override?: '1' | '2' }[] = [
  { count: 2 }, { count: 3 }, { count: 4 }, { count: 2, override: '2' }, { count: 4, override: '1' },
];
for (const { count, override } of realBoards) {
  const roomsPerColor = override ? Number(override) : count - 1;
  test(`${count} real mages start with ${roomsPerColor} room(s) per color (${override ? 'host override' : 'automatic'}) and four protected cells`, async ({ browser }, info) => {
    test.setTimeout(120_000);
    const viewport = count === 3 ? { width: 1440, height: 1200 } : { width: 390, height: 844 };
    const pages = await Promise.all(Array.from({ length: count }, () => browser.newPage({ viewport, reducedMotion: 'reduce' })));
    const errors: string[] = [], states: (GameState | undefined)[] = [];
    const roomId = `lodge-${count}-${override ?? 'auto'}-${info.workerIndex}-${info.retry}-${Date.now()}`;
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framereceived', frame => {
        const message = JSON.parse(String(frame.payload)); if (message.type === 'STATE') states[index] = message.state;
      }));
    }
    try {
      for (const [index, page] of pages.entries()) {
        await page.goto('/'); await page.getByLabel('Mage name').fill(`Default Mage ${index + 1}`);
        await page.getByLabel('Room name').fill(roomId);
        await page.getByRole('button', { name: index ? 'Join room' : 'Create room', exact: true }).click();
        const size = page.getByRole('combobox', { name: 'Rooms per color', exact: true });
        await expect(size).toHaveValue('auto');
        if (index) await expect(size).toBeDisabled(); else await expect(size).toBeEnabled();
        await page.getByRole('combobox', { name: 'Starting magic school', exact: true }).selectOption('cantrip');
      }
      if (override) {
        await pages[0].getByRole('combobox', { name: 'Rooms per color', exact: true }).selectOption(override);
        for (const page of pages) await expect(page.getByRole('combobox', { name: 'Rooms per color', exact: true })).toHaveValue(override);
      }
      for (const page of pages) await page.getByRole('button', { name: 'Mark ready', exact: true }).click();
      for (const [index, page] of pages.entries()) {
        await expect(page.locator('.phase-track .current span')).toHaveText('(not) Black Rose'); await dismissOverlay(page);
        await expect(page.locator('.board .hex')).toHaveCount(roomsPerColor * 6 + 5);
        await expect(page.locator('.board .hex.start-room')).toHaveCount(4);
        for (const color of ['crimson', 'azure', 'emerald', 'amber', 'violet', 'grey']) {
          await expect(page.locator(`.board .hex[data-color="${color}"]`)).toHaveCount(roomsPerColor);
        }
        const state = states[index]!;
        expect(state.board.rooms).toHaveLength(roomsPerColor * 6 + 5);
        expect(state.roomsPerColor).toBe(override ? Number(override) : undefined);
        for (const p of state.players) {
          const start = state.board.rooms.find(room => room.startingFor === p.id)!;
          expect(p.wizard.position).toEqual(start.tiles[0]);
          await expect(page.locator(`.hex[data-room-id="${start.id}"] [data-mage-id="${p.id}"]`)).toHaveCount(1);
        }
        expect(new Set(state.board.rooms.map(room => room.name)).size).toBe(roomsPerColor * 6 + 5);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      expect(errors).toEqual([]);
    } finally { await Promise.all(pages.map(page => page.close())); }
  });
}