import { test, expect, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { closeControls, openMageDetails, selectControlTab, selectSpells, viewRetinue } from './layout-ui';
import { applyAction, BLACK_ROSE_ID, createGame, MAGE_COLORS } from '../packages/game-engine/src/index';
import type { Card, Evocation, GameAction, GameState, Hex } from '../packages/game-engine/src/index';

type Slot = Extract<GameAction, { type: 'CAST_SPELL' }>['slot'];
type Cast = Extract<GameAction, { type: 'CAST_SPELL' }>;
type Reply = { action: GameAction; requestId: string; before: GameState; after: GameState };
const origin: Hex = { q: 0, r: 0 };
const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const messages: string[] = []; faults.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
test.afterEach(async ({ page }) => {
  expect(faults.get(page), 'No browser errors or rejected engine commands').toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

function evocation(id: string, playerId: string, number = 1, position = origin): Evocation {
  return { id, playerId, number, name: 'Cadaver', archetype: 'UNDEAD', movement: 2, attack: 2,
    health: 2, passive: 'WOUNDED_FURY', position: { ...position }, damageCubes: 0, damageByPlayer: {}, activated: false };
}
function fixture(): GameState {
  const game = createGame(4);
  game.gameId = 'transmutation-browser'; game.round = 1; game.phase = 'ACTION';
  game.firstPlayerId = game.currentPlayerId = 'p1';
  game.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
    spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
  game.players.forEach((p, i) => {
    p.name = ['Rose Warden', 'Blue Seer', 'Amber Sage', 'Green Mage'][i];
    p.connected = p.ready = true;
    p.wizard.position = i < 2 ? { ...origin } : { q: 0, r: i - 1 };
  });
  game.board.rooms.forEach((room, i) => { room.name = room.id === 'room-0,0' ? 'Rose Chamber' : `Chamber ${i + 1}`; });
  game.evocations = [evocation('own-one', 'p1'), evocation('enemy-one', 'p2')];
  return game;
}
function prepare(game: GameState, name: string, slot: Slot = 'slot1'): Card {
  const deck = game.library.find(d => d.cards.some(c => c.name === name))!;
  expect(deck, `A real printed ${name} must be available`).toBeDefined();
  const card = deck.cards.splice(deck.cards.findIndex(c => c.name === name), 1)[0];
  game.players[0].prepared[slot] = { card, used: false };
  return card;
}
function roomAt(game: GameState, id = 'room-0,0') { return game.board.rooms.find(r => r.id === id)!; }
function modelAt(game: GameState, id: string) {
  const mage = game.players.find(p => p.id === id);
  return mage ? mage.wizard : game.evocations.find(e => e.id === id)!;
}
function wound(game: GameState, id: string, ledger: Record<string, number>, unattributed = 0, blackDamage = 0) {
  const model = modelAt(game, id);
  model.damageByPlayer = { ...ledger };
  model.damageCubes = Object.values(ledger).reduce((sum, n) => sum + n, 0) + unattributed + blackDamage;
  const mage = game.players.find(p => p.id === id);
  if (mage) mage.wizard.blackDamage = blackDamage;
}
// All colored cubes are physical: no fixture may silently invent stock or wounds.
function syncCubes(game: GameState) {
  for (const p of game.players) {
    p.cubes.onWizard = game.players.reduce((sum, target) => sum + (target.wizard.damageByPlayer[p.id] ?? 0), 0);
    p.cubes.onEvocations = game.evocations.reduce((sum, target) => sum + (target.damageByPlayer[p.id] ?? 0), 0);
    p.cubes.onBoard = game.board.rooms.filter(r => !r.scored && !r.reconstructed).reduce((sum, r) => sum + (r.cubesByPlayer[p.id] ?? 0), 0);
    p.cubes.available = 25 - p.cubes.onWizard - p.cubes.onEvocations - p.cubes.onBoard;
  }
  conserved(game);
}
function conserved(game: GameState) {
  for (const p of game.players) {
    expect(Object.values(p.cubes).every(n => Number.isInteger(n) && n >= 0)).toBe(true);
    expect(Object.values(p.cubes).reduce((sum, n) => sum + n, 0)).toBe(25);
    expect(p.cubes.onWizard).toBe(game.players.reduce((sum, t) => sum + (t.wizard.damageByPlayer[p.id] ?? 0), 0));
    expect(p.cubes.onEvocations).toBe(game.evocations.reduce((sum, t) => sum + (t.damageByPlayer[p.id] ?? 0), 0));
    expect(p.cubes.onBoard).toBe(game.board.rooms.filter(r => !r.scored && !r.reconstructed).reduce((sum, r) => sum + (r.cubesByPlayer[p.id] ?? 0), 0));
  }
}
function physicalCards(game: GameState): string[] {
  return [...game.library.flatMap(d => [...d.cards, ...d.discard]), ...game.powerfulDeck, ...game.removedCards,
    ...game.players.flatMap(p => [...p.hand, ...p.personalDeck, ...p.discard,
      ...Object.values(p.prepared).flatMap(c => c && !c.used ? [c.card] : [])])].map(c => c.id).sort();
}
async function mount(page: Page, initial: GameState) {
  let game = initial, socket: WebSocketRoute;
  const replies: Reply[] = [];
  conserved(game);
  await page.routeWebSocket('**', route => {
    socket = route;
    route.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: game.gameId }));
        route.send(JSON.stringify({ type: 'STATE', state: game }));
      } else if (message.action) {
        const before = game;
        try {
          // The actual browser command, not a fixture-specific imitation, resolves the reply.
          game = applyAction(game, message.action);
          conserved(game);
          replies.push({ ...message, before, after: game });
          route.send(JSON.stringify({ type: 'STATE', state: game }));
          route.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: message.requestId }));
        } catch (error) {
          faults.get(page)!.push(`Engine rejected ${JSON.stringify(message.action)}: ${String(error)}`);
          route.send(JSON.stringify({ type: 'ERROR', requestId: message.requestId, message: String(error) }));
        }
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.locator('.app')).toBeVisible();
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toHaveCount(0);
  if (game.phase === 'ACTION') await selectSpells(page);
  return { replies, get state() { return game; }, update(state: GameState) {
    conserved(state); game = state; socket.send(JSON.stringify({ type: 'STATE', state }));
  } };
}
type Wire = Awaited<ReturnType<typeof mount>>;
const hex = (page: Page, id = 'room-0,0') => page.locator(`.hex[data-room-id="${id}"]`);
const player = (page: Page, id: string) => page.locator(`.player[data-player-id="${id}"]`);
const prepared = (page: Page, slot: Slot = 'slot1') => page.locator('.prepared .spell').filter({
  has: page.locator('.eyebrow', { hasText: slot === 'rapid' ? 'Quick' : `Spell ${slot.slice(-1)}` }),
});
const targetSelect = (page: Page) => page.getByRole('combobox', { name: 'Spell target model', exact: true });
const castButton = (page: Page) => page.locator('.room-detail').getByRole('button', { name: /^Cast / });
const rgb = (id: string) => {
  const color = MAGE_COLORS[id] ?? '#d4cedd';
  return `rgb(${[1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16)).join(', ')})`;
};
async function expectOptions(page: Page, ids: string[]) {
  const select = targetSelect(page);
  await expect(select).toBeVisible();
  await expect(select.locator('option')).toHaveCount(ids.length + 1);
  expect(await select.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value))).toEqual(['', ...ids]);
  await expect(select.locator('option').first()).toHaveText('First eligible model in this room');
}
async function expectTargetModes(page: Page) {
  const selected = page.locator('.prepared .spell.chosen');
  await expect(selected).toHaveCount(1);
  // Assert eligibility from this selected card's printed category, not its effects.
  const eligible = /·\s*(Mage|Evocation|Model)$/.test((await selected.locator('.eyebrow').textContent())!.trim());
  await expect(page.locator('.target-mode')).toHaveCount(eligible ? 1 : 0);
  const model = page.getByRole('button', { name: 'Target model', exact: true });
  const dummy = page.getByRole('button', { name: 'Target dummy · no damage', exact: true });
  await expect(model).toHaveCount(eligible ? 1 : 0);
  await expect(dummy).toHaveCount(eligible ? 1 : 0);
  if (eligible) {
    await expect(model).toHaveAttribute('aria-pressed', 'true');
    await expect(dummy).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(page.locator('.dummy-target-help')).toHaveCount(0);
}
async function expectDamage(card: Locator, model: { health: number; damageCubes: number; damageByPlayer: Record<string, number>; blackDamage?: number }) {
  const meter = card.getByRole('meter');
  await expect(meter).toHaveAttribute('aria-valuenow', String(model.damageCubes));
  await expect(meter).toHaveAttribute('aria-valuemax', String(model.health));
  await expect(meter).toHaveAttribute('aria-valuetext', `${model.damageCubes} damage cubes / ${model.health} capacity`);
  await expect(card.locator('.damage-count')).toHaveText(`${model.damageCubes} damage cubes / ${model.health} capacity`);
  const ledger = { ...model.damageByPlayer };
  if (model.blackDamage) ledger[BLACK_ROSE_ID] = (ledger[BLACK_ROSE_ID] ?? 0) + model.blackDamage;
  const unattributed = model.damageCubes - Object.values(ledger).reduce((sum, n) => sum + n, 0);
  if (unattributed > 0) ledger.unattributed = unattributed;
  const positive = Object.entries(ledger).filter(([, n]) => n > 0);
  await expect(meter.locator('.damage-segment')).toHaveCount(positive.length);
  for (const [owner, count] of positive) {
    const segment = meter.locator(`[data-owner-id="${owner}"]`);
    await expect(segment).toHaveAttribute('data-cubes', String(count));
    expect(await segment.evaluate(el => parseFloat((el as HTMLElement).style.width))).toBeCloseTo(count / model.health * 100, 5);
    await expect(segment).toHaveCSS('background-color', rgb(owner));
  }
}
async function expectModels(page: Page, game: GameState) {
  for (const p of game.players) {
    const card = await openMageDetails(page, p.id);
    await expectDamage(card, p.wizard);
    await expect(card.locator('[title="Available cubes"]')).toHaveText(`◆ ${p.cubes.available} available`);
    await expect(card.locator('.cube-pool')).toHaveText(`◆ On mages: ${p.cubes.onWizard} · On evocations: ${p.cubes.onEvocations} · In rooms: ${p.cubes.onBoard}`);
    await viewRetinue(page, p.id);
    await expect(page.locator(`#retinue-${p.id} .evocation-card`)).toHaveCount(game.evocations.filter(e => e.playerId === p.id).length);
  }
  for (const e of game.evocations) await expectDamage(page.locator(`.evocation-card[data-evocation-id="${e.id}"]`), e);
  await expect(page.locator('.evocation-marker')).toHaveCount(game.evocations.length);
}
async function cast(page: Page, wire: Wire, expected: Cast) {
  const index = wire.replies.length;
  await closeControls(page);
  await expect(castButton(page)).toBeEnabled();
  await castButton(page).click();
  await expect.poll(() => wire.replies.length).toBe(index + 1);
  const reply = wire.replies[index], before = reply.before, after = reply.after;
  expect(reply.action).toEqual(expected); // Exact equality also forbids roomId/dummy on individuals.
  expect(after).not.toBe(before);
  expect(physicalCards(after)).toEqual(physicalCards(before));
  const card = before.players[0].prepared[expected.slot]!.card;
  expect(after.players[0].prepared[expected.slot]).toMatchObject({ card, used: true });
  expect(after.library.find(d => d.id === card.schoolId)!.discard).toContainEqual(card);
  expect(after.players[0].discard).toEqual(before.players[0].discard);
  for (const deck of before.library.filter(d => d.id !== card.schoolId)) expect(after.library.find(d => d.id === deck.id)).toEqual(deck);
  expect(after.players[0].actionTokens).toBe(before.players[0].actionTokens);
  if (before.activation!.actionsUsed === 0) {
    expect(after.activation).toMatchObject({ playerId: 'p1', actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: expected.slot !== 'rapid' });
    await expect(page.locator('.phase-panel .badge')).toHaveText('1 turn actions left');
    await selectControlTab(page, 'Actions');
    await expect(page.getByRole('button', { name: /^End turn/ })).toBeEnabled(); // Wait for the request ACK too.
  } else {
    expect(after.currentPlayerId).toBe('p2');
    await expect(page.locator('.phase-panel .badge')).toHaveText('Waiting');
    await expect(page.locator('.prepared .spell:enabled')).toHaveCount(0);
  }
  await expect(prepared(page, expected.slot)).toHaveClass(/used/);
  await expect(page.locator('.spell.chosen')).toHaveCount(0);
  await expectModels(page, after);
  conserved(after);
  await selectSpells(page);
  return after;
}

for (const viewport of [{ width: 1440, height: 1200 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px support spells`, () => {
    test.use({ viewport });

    test('SELF auto-selects only the caster, heals real wounds and returns cubes without spending a token', async ({ page }, info) => {
      const game = fixture(); prepare(game, 'Mending Light');
      wound(game, 'p1', { p2: 2, [BLACK_ROSE_ID]: 1 }, 1, 1); syncCubes(game);
      game.players[0].wizard.position = { ...roomAt(game, game.players[0].wizard.startingRoomId).tiles[0] };
      const wire = await mount(page, game);
      await expect(prepared(page)).toContainText('Spell 1 · Self');
      await expect(prepared(page).locator('.heal-effect')).toHaveText('♥ 3 heal');
      await expect(prepared(page)).toBeDisabled();
      await expect(page.locator('.room-detail button')).toHaveCount(0);
      const outside = structuredClone(wire.state); outside.players[0].wizard.position = { ...origin }; wire.update(outside);
      await expect(prepared(page)).toBeEnabled(); await prepared(page).click();
      // No board click: selecting SELF must open the correct room immediately.
      await expect(hex(page)).toHaveClass(/selected/);
      await expect(page.locator('.room-detail')).toContainText('This spell targets only your mage.');
      await expect(castButton(page)).toHaveText('Cast Mending Light on yourself');
      await expect(targetSelect(page)).toHaveCount(0); await expectTargetModes(page);
      expect(wire.replies).toHaveLength(0);
      await expectModels(page, wire.state);
      await info.attach(`self-confirm-${viewport.width}`, { body: await page.locator('.room-detail').screenshot(), contentType: 'image/png' });
      const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p1' });
      expect(after.players[0].wizard).toMatchObject({ damageCubes: 2, damageByPlayer: {}, blackDamage: 1 });
      expect(after.players[1].cubes).toEqual({ available: 25, onWizard: 0, onEvocations: 0, onBoard: 0 });
      await expect(player(page, 'p1')).toContainText('(not) Black Rose: 1');
      await expect(player(page, 'p1')).toContainText('Unattributed wounds (no cube available): 1');
    });

    const supports = [
      { name: 'Renewing Word', target: 'MAGE', effect: 'heal', amount: 3, own: 'p1', enemy: 'p2', options: ['p1', 'p2'] },
      { name: "Mage's Due", target: 'MAGE', effect: 'convert', amount: 3, own: 'p1', enemy: 'p2', options: ['p1', 'p2'] },
      { name: "Summoner's Balm", target: 'EVOCATION', effect: 'heal', amount: 2, own: 'own-one', enemy: 'enemy-one', options: ['own-one', 'enemy-one'] },
      { name: 'Reclaimed Servant', target: 'EVOCATION', effect: 'convert', amount: 2, own: 'own-one', enemy: 'enemy-one', options: ['own-one', 'enemy-one'] },
      { name: 'Vital Thread', target: 'MODEL', effect: 'heal', amount: 2, own: 'own-one', enemy: 'p2', options: ['p1', 'p2', 'own-one', 'enemy-one'] },
      { name: 'Stolen Sigil', target: 'MODEL', effect: 'convert', amount: 2, own: 'p1', enemy: 'enemy-one', options: ['p1', 'p2', 'own-one', 'enemy-one'] },
    ];
    for (const scenario of supports) {
      test(`${scenario.target} ${scenario.effect}: filtered own/enemy choices, typed commands, actual ledgers and two-action handoff`, async ({ page }) => {
        const game = fixture(); prepare(game, scenario.name); prepare(game, scenario.name, 'rapid');
        // Larger explicit fixture capacities allow partial healing/conversion without accidental destruction.
        game.evocations.forEach(e => { e.health = 4; });
        wound(game, scenario.own, { p3: 3 }); wound(game, scenario.enemy, { p3: 3 }); syncCubes(game);
        const wire = await mount(page, game);
        await expectModels(page, wire.state);
        for (const [index, id] of [scenario.own, scenario.enemy].entries()) {
          await selectSpells(page);
          const slot: Slot = index === 0 ? 'slot1' : 'rapid';
          const card = prepared(page, slot);
          await expect(card).toContainText(`· ${scenario.target === 'MAGE' ? 'Mage' : scenario.target === 'EVOCATION' ? 'Evocation' : 'Model'}`);
          await expect(card.locator(`.${scenario.effect}-effect`)).toContainText(`${scenario.amount} ${scenario.effect}`);
          await card.click(); await expectTargetModes(page); await hex(page).click();
          await expectOptions(page, scenario.options);
          await expect(targetSelect(page)).toHaveValue('');
          await targetSelect(page).selectOption(id);
          const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot,
            ...(game.players.some(p => p.id === id) ? { targetPlayerId: id } : { targetEvocationId: id }) });
          const ownConversion = scenario.effect === 'convert' && index === 0;
          const changed = ownConversion ? 0 : scenario.amount, remaining = 3 - changed;
          const ledger: Record<string, number> = scenario.effect === 'heal' ? (remaining ? { p3: remaining } : {})
            : { ...(changed ? { p1: changed } : {}), p3: remaining };
          expect(modelAt(after, id).damageCubes).toBe(scenario.effect === 'heal' ? remaining : 3);
          expect(modelAt(after, id).damageByPlayer).toEqual(Object.fromEntries(Object.entries(ledger).filter(([, n]) => n > 0)));
          expect(after.players[2].cubes.available).toBe(19 + scenario.amount * (scenario.effect === 'convert' ? index : index + 1));
          if (ownConversion) {
            expect(modelAt(after, id)).toEqual(modelAt(game, id));
            expect(after.players.map(p => p.cubes)).toEqual(game.players.map(p => p.cubes));
            expect(after.feedbackEvents).toEqual(game.feedbackEvents);
            await expect(page.locator('.feedback-pulse[data-feedback-kind="CONVERT"]')).toHaveCount(0);
          } else if (scenario.effect === 'convert') {
            expect((after.feedbackEvents ?? []).filter(event => event.kind === 'CONVERT')).toEqual([
              expect.objectContaining({ kind: 'CONVERT', amount: changed, sourceId: 'p1',
                target: expect.objectContaining({ id }) }),
            ]);
          }
          expect(after.board).toEqual(game.board);
        }
        expect(wire.replies.map(r => r.action.type)).toEqual(['CAST_SPELL', 'CAST_SPELL']);
        expect(wire.state.players[0].actionTokens).toBe(2);
        expect(wire.state.library.find(d => d.id === 'transmutation')!.discard).toHaveLength(2);
      });
    }

    for (const category of ['MAGE', 'EVOCATION', 'MODEL'] as const) {
      test(`${category} support dropdown and room highlights enforce model LOS, range and protected starts`, async ({ page }) => {
        const game = fixture();
        prepare(game, category === 'MAGE' ? 'Renewing Word' : category === 'EVOCATION' ? 'Reclaimed Servant' : 'Vital Thread');
        // A multihex room has one legal tile and one off-axis tile. Only the legal model belongs in the dropdown.
        roomAt(game, 'room-1,0').tiles.push({ q: 1, r: 1 });
        game.board.rooms = game.board.rooms.filter(r => r.id !== 'room-1,1');
        game.players[1].wizard.position = { q: 1, r: 0 };
        game.players[2].wizard.position = { q: 1, r: 1 };
        const start = game.board.rooms.find(r => r.startingFor)!;
        const protectedHex = { q: 2, r: 0 };
        // Put a protected room on the caster's axis, so LOS cannot mask missing start protection.
        game.board.rooms = game.board.rooms.filter(r => r.id !== 'room-2,0');
        start.tiles = [{ ...protectedHex }];
        game.players[3].wizard.position = { ...protectedHex };
        game.evocations = [evocation('own-one', 'p1'), evocation('legal-enemy', 'p2', 1, { q: 1, r: 0 }),
          evocation('off-axis', 'p3', 1, { q: 1, r: 1 }), evocation('protected', 'p4', 1, protectedHex)];
        const wire = await mount(page, game);
        await prepared(page).click(); await expectTargetModes(page);
        await hex(page, 'room-1,0').click();
        // The room represents all its tiles, including models in a secondary tile.
        await expect(hex(page, 'room-1,0').locator('[data-mage-id="p3"]')).toHaveCount(1);
        await expect(hex(page, 'room-1,0').locator('.evocation-marker[data-evocation-id="off-axis"]')).toHaveCount(1);
        await expectOptions(page, category === 'MAGE' ? ['p2'] : category === 'EVOCATION' ? ['legal-enemy'] : ['p2', 'legal-enemy']);
        await expect(hex(page, 'room-1,0')).toHaveClass(/reachable/);
        await expect(castButton(page)).toBeEnabled();
        await hex(page, start.id).click();
        await expectOptions(page, []); await expect(castButton(page)).toBeDisabled();
        await expect(hex(page, start.id)).not.toHaveClass(/reachable/);
        // Broadcast models into an off-axis room: neither the room nor options may stay eligible.
        const offAxis = structuredClone(wire.state);
        offAxis.players[1].wizard.position = { q: -1, r: -1 };
        offAxis.evocations.find(e => e.id === 'legal-enemy')!.position = { q: -1, r: -1 }; wire.update(offAxis);
        await hex(page, 'room--1,-1').click(); await expectOptions(page, []);
        await expect(castButton(page)).toBeDisabled(); await expect(hex(page, 'room--1,-1')).not.toHaveClass(/reachable/);
        // All models on a distant straight line are outside each printed spell's range.
        const distant = structuredClone(wire.state);
        roomAt(distant, 'room--1,0').tiles.push({ q: 4, r: 0 });
        distant.players[1].wizard.position = { q: 4, r: 0 };
        distant.evocations.find(e => e.id === 'legal-enemy')!.position = { q: 4, r: 0 }; wire.update(distant);
        await hex(page, 'room--1,0').click(); await expectOptions(page, []);
        await expect(castButton(page)).toBeDisabled(); await expect(hex(page, 'room--1,0')).not.toHaveClass(/reachable/);
        expect(wire.replies).toHaveLength(0);
        // Restore legal candidates and use the default: its typed payload must use the first legal model only.
        wire.update(game); await hex(page, 'room-1,0').click();
        const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1',
          ...(category === 'EVOCATION' ? { targetEvocationId: 'legal-enemy' } : { targetPlayerId: 'p2' }) });
        expect(after.players.map(p => p.wizard)).toEqual(game.players.map(p => p.wizard));
        expect(after.evocations).toEqual(game.evocations); // Legal zero-effect casts still cost an action/card.
      });
    }

    test('ROOM heal reaches every friendly/enemy mage and evocation, never a model outside that room', async ({ page }, info) => {
      const game = fixture(); prepare(game, 'Sanctuary');
      for (const id of ['p1', 'p2']) wound(game, id, { p3: 3 });
      for (const id of ['own-one', 'enemy-one']) wound(game, id, { p4: 1 });
      game.evocations.push(evocation('outside', 'p2', 2, { q: 0, r: 1 })); wound(game, 'outside', { p4: 1 }); syncCubes(game);
      const wire = await mount(page, game);
      await expectModels(page, game); await selectSpells(page); await prepared(page).click(); await expectTargetModes(page);
      await expect(prepared(page)).toContainText('Spell 1 · Room'); await hex(page).click();
      await expect(targetSelect(page)).toHaveCount(0);
      const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: 'room-0,0' });
      expect(after.players.slice(0, 2).map(p => p.wizard.damageCubes)).toEqual([1, 1]);
      expect(after.evocations.map(e => e.damageCubes)).toEqual([0, 0, 1]);
      expect(after.evocations.find(e => e.id === 'outside')).toEqual(game.evocations.find(e => e.id === 'outside'));
      expect(after.players[2].cubes).toEqual({ available: 23, onWizard: 2, onEvocations: 0, onBoard: 0 });
      expect(after.players[3].cubes).toEqual({ available: 24, onWizard: 0, onEvocations: 1, onBoard: 0 });
      expect(after.blackRose).toEqual(game.blackRose);
      await selectControlTab(page, 'Evocations');
      await info.attach(`room-heal-retinue-${viewport.width}`, { body: await page.locator('#retinue-p1').screenshot(), contentType: 'image/png' });
    });

    for (const full of [false, true]) {
      test(`ROOM conversion replaces live ${full ? 'full' : 'partial'} room cube ownership without altering totals or model wounds`, async ({ page }, info) => {
        const game = fixture(); prepare(game, 'Rewrite the Lodge');
        const room = roomAt(game); room.instability = full ? room.instabilityLimit : 5;
        room.cubesByPlayer = { p1: 1, p2: 2, p3: 1, [BLACK_ROSE_ID]: room.instability - 4 };
        wound(game, 'p2', { p4: 2 }); wound(game, 'own-one', { p3: 1 }); syncCubes(game);
        const wire = await mount(page, game);
        await prepared(page).click(); await expectTargetModes(page); await hex(page).click();
        await expect(prepared(page).locator('.convert-effect')).toHaveText('↻ 3 convert · room cubes');
        await expect(targetSelect(page)).toHaveCount(0);
        const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: room.id });
        const result = roomAt(after);
        expect(result).toMatchObject({ instability: room.instability, reconstructed: false, scored: false,
          cubesByPlayer: { p1: 4, [BLACK_ROSE_ID]: room.instability - 4 } });
        expect(result.cubesByPlayer.p2 ?? 0).toBe(0); expect(result.cubesByPlayer.p3 ?? 0).toBe(0);
        expect(after.players.map(p => p.wizard)).toEqual(game.players.map(p => p.wizard)); expect(after.evocations).toEqual(game.evocations);
        expect(after.players[0].cubes).toEqual({ available: 21, onWizard: 0, onEvocations: 0, onBoard: 4 });
        expect(after.players[1].cubes.available).toBe(25); expect(after.players[2].cubes.available).toBe(24);
        expect(after.players.every(p => p.victoryPoints === 0 && p.kills === 0 && p.questsCompleted === 0)).toBe(true);
        await expect(hex(page).locator('.cube-count')).toHaveText(`◆ ${room.instability}/${room.instabilityLimit}`);
        await expect(hex(page).locator('.capacity-fill')).toHaveCount(2);
        for (const [owner, cubes] of [['p1', 4], [BLACK_ROSE_ID, room.instability - 4]] as const) {
          const segment = hex(page).locator(`.capacity-fill[data-owner-id="${owner}"]`);
          await expect(segment).toHaveAttribute('data-cubes', String(cubes));
          expect(Number(await segment.getAttribute('width'))).toBeCloseTo(34 * cubes / room.instabilityLimit, 5);
          await expect(segment).toHaveCSS('fill', rgb(owner));
        }
        await expect(page.locator('.room-detail .contributions')).toContainText('Rose Warden: 4');
        await expect(page.locator('.room-detail .contributions')).not.toContainText(/Blue Seer|Amber Sage/);
        if (full) await expect(page.locator('.room-detail')).toContainText('Full: locked to new cubes; rebuilds at Cleanup');
        await info.attach(`converted-room-${full}-${viewport.width}`, { body: await page.locator('.room-detail').screenshot(), contentType: 'image/png' });
      });
    }

    for (const kind of ['mage', 'evocation'] as const) for (const own of [true, false]) {
      test(`mixed MODEL conversion/damage targets ${own ? 'friendly' : 'enemy'} ${kind} but never damages friends`, async ({ page }) => {
        const game = fixture(); prepare(game, 'Transmuting Surge');
        const id = kind === 'mage' ? (own ? 'p1' : 'p2') : (own ? 'own-one' : 'enemy-one');
        wound(game, id, { p3: 1 }); syncCubes(game);
        const wire = await mount(page, game);
        await prepared(page).click(); await expectTargetModes(page); await hex(page).click();
        await expectOptions(page, ['p1', 'p2', 'own-one', 'enemy-one']); await targetSelect(page).selectOption(id);
        const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1',
          ...(kind === 'mage' ? { targetPlayerId: id } : { targetEvocationId: id }) });
        if (!own && kind === 'evocation') {
          expect(after.evocations.some(e => e.id === id)).toBe(false);
          await expect(page.locator(`.evocation-marker[data-evocation-id="${id}"]`)).toHaveCount(0);
          await selectControlTab(page, 'Evocations');
          await expect(page.getByRole('button', { name: 'Hide evocations for Blue Seer (0)', exact: true })).toBeVisible();
          expect(after.players[0].cubes.available).toBe(25); // Converted and final-hit cubes both returned.
        } else if (own) {
          expect(modelAt(after, id)).toEqual(modelAt(game, id));
          expect(after.players.map(p => p.cubes)).toEqual(game.players.map(p => p.cubes));
          expect(after.feedbackEvents).toEqual(game.feedbackEvents); // Neither friendly CONVERT nor DAMAGE resolves.
          await expect(page.locator('.feedback-pulse')).toHaveCount(0);
        } else {
          expect(modelAt(after, id)).toMatchObject({ damageCubes: 2, damageByPlayer: { p1: 2 } });
          expect(after.players[0].cubes.onWizard).toBe(2);
        }
        expect(after.players[2].cubes.available).toBe(own ? 24 : 25);
        expect(after.board).toEqual(game.board);
        expect(after.players.every(p => p.kills === 0 && p.victoryPoints === 0)).toBe(true);
      });
    }

    test('switching cards clears selected model, room and dummy mode; Combat Cantrip dummy remains harmless', async ({ page }) => {
      const game = fixture(); prepare(game, 'Splinter Hex'); prepare(game, 'Vital Thread', 'rapid');
      wound(game, 'p1', { p3: 2 }); wound(game, 'own-one', { p3: 1 }); syncCubes(game);
      const wire = await mount(page, game);
      await prepared(page, 'rapid').click(); await hex(page).click();
      await targetSelect(page).selectOption('own-one'); await expect(targetSelect(page)).toHaveValue('own-one');
      await selectSpells(page); await prepared(page).click();
      await expect(page.locator('.room-detail,.hex.selected')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Target model', exact: true })).toHaveClass(/primary/);
      await expectTargetModes(page);
      await hex(page).click(); await expectOptions(page, ['p2', 'enemy-one']); await expect(targetSelect(page)).toHaveValue('');
      await targetSelect(page).selectOption('enemy-one');
      await page.getByRole('button', { name: 'Target dummy · no damage', exact: true }).click();
      await expect(page.locator('.room-detail')).toHaveCount(0); await hex(page).click();
      await expect(castButton(page)).toHaveText('Cast Splinter Hex here on dummy');
      await expect(targetSelect(page)).toHaveCount(0);
      await selectSpells(page); await prepared(page, 'rapid').click(); await expectTargetModes(page);
      await expect(page.locator('.room-detail,.hex.selected')).toHaveCount(0);
      await hex(page).click(); await expectOptions(page, ['p1', 'p2', 'own-one', 'enemy-one']);
      await expect(targetSelect(page)).toHaveValue('');
      // Default must now resolve to the own mage, not the stale evocation or dummy room payload.
      const healed = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p1' });
      expect(healed.players[0].wizard.damageCubes).toBe(0); expect(healed.evocations[0].damageCubes).toBe(1);
      await selectSpells(page); await prepared(page).click();
      await page.getByRole('button', { name: 'Target dummy · no damage', exact: true }).click(); await hex(page).click();
      const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: 'room-0,0', dummy: true });
      expect(after.players.map(p => p.wizard)).toEqual(healed.players.map(p => p.wizard)); expect(after.evocations).toEqual(healed.evocations);
      expect(roomAt(after)).toMatchObject({ instability: 1, cubesByPlayer: { p1: 1 } });
      expect(after.library.map(d => ({ id: d.id, discards: d.discard.length }))).toEqual([
        { id: 'cantrip', discards: 1 }, { id: 'transmutation', discards: 1 }, { id: 'enchantment', discards: 0 },
      ]);
    });
  });
}