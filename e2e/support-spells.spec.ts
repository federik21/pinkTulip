import { test, expect, type Locator, type Page } from '@playwright/test';
import { openMageDetails, selectControlTab, viewRetinue } from './layout-ui';
import { applyAction, BLACK_ROSE_ID, createGame, MAGE_COLORS } from '../packages/game-engine/src/index';
import type { Card, Evocation, GameAction, GameState, Hex, Room } from '../packages/game-engine/src/index';

type Cast = Extract<GameAction, { type: 'CAST_SPELL' }>;
type Slot = Cast['slot'];
type Reply = { action: GameAction; before: GameState; after: GameState };
const origin: Hex = { q: 0, r: 0 };
const faults = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const messages: string[] = []; faults.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
test.afterEach(async ({ page }) => {
  expect(faults.get(page), 'No browser errors or rejected authoritative actions').toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

function evocation(id: string, playerId: string, position = origin, number = 1): Evocation {
  return { id, playerId, number, name: 'Cadaver', archetype: 'UNDEAD', movement: 2, attack: 2,
    health: 2, passive: 'WOUNDED_FURY', position: { ...position }, damageCubes: 0, damageByPlayer: {}, activated: false };
}
function fixture(): GameState {
  const game = createGame(4);
  game.gameId = 'support-spells'; game.round = 1; game.phase = 'ACTION';
  game.firstPlayerId = game.currentPlayerId = 'p1';
  game.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
    spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
  game.players.forEach((p, i) => {
    p.name = ['Rose Warden', 'Blue Seer', 'Amber Sage', 'Green Mage'][i];
    p.connected = p.ready = true;
    p.wizard.position = i < 2 ? { ...origin } : { q: 0, r: i - 1 };
  });
  game.board.rooms.forEach((room, i) => { room.name = `Support Chamber ${i + 1}`; });
  game.evocations = [evocation('own-one', 'p1'), evocation('enemy-one', 'p2')];
  return game;
}
function prepare(game: GameState, name: string, slot: Slot = 'slot1'): Card {
  const deck = game.library.find(d => d.cards.some(c => c.name === name));
  expect(deck, `The printed ${name} must exist in a school supply`).toBeDefined();
  const [card] = deck!.cards.splice(deck!.cards.findIndex(c => c.name === name), 1);
  game.players[0].prepared[slot] = { card, used: false };
  return card;
}
const roomAt = (game: GameState, id = 'room-0,0') => game.board.rooms.find(r => r.id === id)!;
function modelAt(game: GameState, id: string) {
  return game.players.find(p => p.id === id)?.wizard ?? game.evocations.find(e => e.id === id)!;
}
function wound(game: GameState, id: string, ledger: Record<string, number>, unattributed = 0, blackDamage = 0) {
  const model = modelAt(game, id);
  model.damageByPlayer = { ...ledger };
  model.damageCubes = Object.values(ledger).reduce((sum, n) => sum + n, 0) + unattributed + blackDamage;
  const mage = game.players.find(p => p.id === id);
  if (mage) mage.wizard.blackDamage = blackDamage;
}
function onBoard(game: GameState, id: string) {
  return game.board.rooms.filter(r => !r.scored && !r.reconstructed).reduce((sum, r) => sum + (r.cubesByPlayer[id] ?? 0), 0);
}
function syncCubes(game: GameState) {
  for (const p of game.players) {
    p.cubes.onWizard = game.players.reduce((sum, t) => sum + (t.wizard.damageByPlayer[p.id] ?? 0), 0);
    p.cubes.onEvocations = game.evocations.reduce((sum, t) => sum + (t.damageByPlayer[p.id] ?? 0), 0);
    p.cubes.onBoard = onBoard(game, p.id);
    p.cubes.available = 25 - p.cubes.onWizard - p.cubes.onEvocations - p.cubes.onBoard;
  }
}
function conserved(game: GameState) {
  for (const p of game.players) {
    expect(Object.values(p.cubes).every(n => Number.isInteger(n) && n >= 0)).toBe(true);
    expect(Object.values(p.cubes).reduce((sum, n) => sum + n, 0)).toBe(25);
    expect(p.cubes.onWizard).toBe(game.players.reduce((sum, t) => sum + (t.wizard.damageByPlayer[p.id] ?? 0), 0));
    expect(p.cubes.onEvocations).toBe(game.evocations.reduce((sum, t) => sum + (t.damageByPlayer[p.id] ?? 0), 0));
    expect(p.cubes.onBoard).toBe(onBoard(game, p.id));
  }
}
function physicalCards(game: GameState) {
  return [...game.library.flatMap(d => [...d.cards, ...d.discard]), ...game.powerfulDeck, ...game.removedCards,
    ...game.players.flatMap(p => [...p.hand, ...p.personalDeck, ...p.discard,
      ...Object.values(p.prepared).flatMap(c => c && !c.used ? [c.card] : [])])].map(c => c.id).sort();
}
async function mount(page: Page, initial: GameState) {
  let game = structuredClone(initial);
  let publish: (state: GameState) => void = () => { throw new Error('Fixture socket is not connected'); };
  const replies: Reply[] = [];
  conserved(game);
  await page.routeWebSocket('**', route => {
    publish = state => route.send(JSON.stringify({ type: 'STATE', state }));
    route.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: game.gameId }));
        publish(game);
      } else if (message.action) {
        try {
          const before = game;
          game = applyAction(game, message.action);
          conserved(game);
          replies.push({ action: message.action, before, after: game });
          publish(game);
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
  await expect(overlay).toBeHidden();
  return { replies, get state() { return game; }, update(state: GameState) {
    conserved(state); game = structuredClone(state); publish(game);
  } };
}
type Wire = Awaited<ReturnType<typeof mount>>;
const hex = (page: Page, id = 'room-0,0') => page.locator(`.hex[data-room-id="${id}"]`);
const player = (page: Page, id: string) => page.locator(`.player[data-player-id="${id}"]`);
// Printed names and slot prefixes stay stable if card-type badges are added.
const prepared = (page: Page, name: string, slot: Slot = 'slot1') => page.locator('.prepared .spell').filter({
  has: page.getByText(name, { exact: true }),
}).filter({ has: page.locator('.eyebrow', { hasText: slot === 'rapid' ? /\bFlexible\b/ : new RegExp(`^Spell ${slot.slice(-1)}\\b`) }) });
const targetSelect = (page: Page) => page.getByRole('combobox', { name: 'Spell target model', exact: true });
const castButton = (page: Page) => page.locator('.room-detail').getByRole('button', { name: /^Cast / });
const color = (id: string) => {
  const value = MAGE_COLORS[id] ?? '#d4cedd';
  return `rgb(${[1, 3, 5].map(start => parseInt(value.slice(start, start + 2), 16)).join(', ')})`;
};
async function noDummy(page: Page) {
  await expect(page.locator('.target-mode')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Target dummy · no damage', exact: true })).toHaveCount(0);
}
async function expectOptions(page: Page, ids: string[]) {
  const select = targetSelect(page);
  await expect(select).toBeVisible();
  await expect(select.locator('option')).toHaveCount(ids.length + 1);
  expect(await select.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value))).toEqual(['', ...ids]);
  await expect(select.locator('option').first()).toHaveText('First eligible model in this room');
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
  if (unattributed) ledger.unattributed = unattributed;
  const entries = Object.entries(ledger).filter(([, n]) => n > 0);
  await expect(meter.locator('.damage-segment')).toHaveCount(entries.length);
  for (const [owner, cubes] of entries) {
    const segment = meter.locator(`[data-owner-id="${owner}"]`);
    await expect(segment).toHaveAttribute('data-cubes', String(cubes));
    await expect(segment).toHaveCSS('background-color', color(owner));
    expect(await segment.evaluate(el => parseFloat((el as HTMLElement).style.width))).toBeCloseTo(100 * cubes / model.health, 5);
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
}
async function cast(page: Page, wire: Wire, expected: Cast) {
  const index = wire.replies.length;
  await expect(castButton(page)).toBeEnabled();
  await castButton(page).click();
  await expect.poll(() => wire.replies.length).toBe(index + 1);
  const { action, before, after } = wire.replies[index];
  expect(action).toEqual(expected); // Forbid stale dummy/room fields on individual commands.
  expect(after).not.toBe(before);
  expect(physicalCards(after)).toEqual(physicalCards(before));
  const card = before.players[0].prepared[expected.slot]!.card;
  expect(after.players[0].prepared[expected.slot]).toMatchObject({ card, used: true });
  expect(after.library.find(d => d.id === card.schoolId)!.discard).toContainEqual(card);
  expect(after.players[0].actionTokens).toBe(before.players[0].actionTokens);
  expect(after.players[0].discard).toEqual(before.players[0].discard);
  for (const deck of before.library.filter(d => d.id !== card.schoolId)) expect(after.library.find(d => d.id === deck.id)).toEqual(deck);
  await expect(prepared(page, card.name, expected.slot)).toHaveClass(/used/);
  await expect(page.locator('.prepared .spell.chosen')).toHaveCount(0);
  if (before.activation!.actionsUsed === 0) {
    expect(after.activation).toMatchObject({ playerId: 'p1', actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: expected.slot !== 'rapid' });
    await expect(page.locator('.phase-panel .badge')).toHaveText('1 turn actions left');
    await selectControlTab(page, 'Actions');
    await expect(page.getByRole('button', { name: /^End turn\b/ })).toBeEnabled();
  } else {
    expect(after.currentPlayerId).toBe('p2');
    await expect(page.locator('.phase-panel .badge')).toHaveText('Waiting');
    await expect(page.locator('.prepared .spell:enabled')).toHaveCount(0);
  }
  conserved(after); await expectModels(page, after);
  return after;
}
async function expectRoomCubes(page: Page, room: Room) {
  const tile = hex(page, room.id);
  if (room.reconstructed) {
    await expect(tile.locator('.capacity-badge')).toHaveCount(0);
    await expect(tile.locator('.rebuilt-badge text')).toHaveText('READY');
    return;
  }
  await expect(tile.locator('.cube-count')).toHaveText(`◆ ${room.instability}/${room.instabilityLimit}`);
  const entries = Object.entries(room.cubesByPlayer).filter(([, n]) => n > 0);
  await expect(tile.locator('.capacity-fill[data-owner-id]')).toHaveCount(entries.length);
  for (const [owner, cubes] of entries) {
    const segment = tile.locator(`.capacity-fill[data-owner-id="${owner}"]`);
    await expect(segment).toHaveAttribute('data-cubes', String(cubes));
    await expect(segment).toHaveCSS('fill', color(owner));
    expect(Number(await segment.getAttribute('width'))).toBeCloseTo(34 * cubes / room.instabilityLimit, 5);
  }
}

for (const viewport of [{ width: 1440, height: 1200 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px support integration`, () => {
    test.use({ viewport });

    for (const name of ['Mending Light', "Alchemist's Refuge"]) {
      test(`SELF ${name} opens the own room, requires self confirmation and cannot follow a different room`, async ({ page }) => {
        const game = fixture(), card = prepare(game, name);
        wound(game, 'p1', { p2: 2, [BLACK_ROSE_ID]: 1 }, 1, 1); syncCubes(game);
        game.players[0].wizard.position = { ...roomAt(game, game.players[0].wizard.startingRoomId).tiles[0] };
        const wire = await mount(page, game), button = prepared(page, name);
        await expect(button).toBeDisabled(); await expect(castButton(page)).toHaveCount(0);
        const outside = structuredClone(wire.state); outside.players[0].wizard.position = { ...origin }; wire.update(outside);
        await expect(button).toBeEnabled(); await button.click();
        await expect(hex(page)).toHaveClass(/selected/);
        await expect(castButton(page)).toHaveText(`Cast ${name} on yourself`);
        await expect(button.locator('.heal-effect')).toContainText(`${card.heal} heal`);
        if (card.convert) await expect(button.locator('.convert-effect')).toContainText(`${card.convert} convert · damage cubes`);
        await expect(targetSelect(page)).toHaveCount(0); await noDummy(page);
        await hex(page, 'room-0,1').click(); await expect(castButton(page)).toBeDisabled();
        await button.click(); await expect(castButton(page)).toHaveCount(0);
        await button.click(); await expect(hex(page)).toHaveClass(/selected/);
        expect(wire.replies).toHaveLength(0);
        await expectModels(page, wire.state);
        const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p1' });
        expect(after.players[0].wizard).toMatchObject({ damageCubes: name === 'Mending Light' ? 2 : 3,
          damageByPlayer: name === 'Mending Light' ? {} : { [BLACK_ROSE_ID]: 1 }, blackDamage: 1 });
        expect(after.players[1].cubes).toEqual({ available: 25, onWizard: 0, onEvocations: 0, onBoard: 0 });
        expect(after.players[0].cubes.available).toBe(25);
        expect(after.players.slice(1).map(p => p.wizard)).toEqual(outside.players.slice(1).map(p => p.wizard));
        expect(after.evocations).toEqual(outside.evocations);
      });
    }

    const supports = [
      { name: 'Renewing Word', effect: 'heal', target: 'MAGE', ids: ['p1', 'p2'], choices: ['p1', 'p2'] },
      { name: "Mage's Due", effect: 'convert', target: 'MAGE', ids: ['p1', 'p2'], choices: ['p1', 'p2'] },
      { name: "Summoner's Balm", effect: 'heal', target: 'EVOCATION', ids: ['own-one', 'enemy-one'], choices: ['own-one', 'enemy-one'] },
      { name: 'Reclaimed Servant', effect: 'convert', target: 'EVOCATION', ids: ['own-one', 'enemy-one'], choices: ['own-one', 'enemy-one'] },
      { name: 'Vital Thread', effect: 'heal', target: 'MODEL', ids: ['p1', 'p2', 'own-one', 'enemy-one'], choices: ['p1', 'enemy-one'] },
      { name: 'Stolen Sigil', effect: 'convert', target: 'MODEL', ids: ['p1', 'p2', 'own-one', 'enemy-one'], choices: ['own-one', 'p2'] },
    ] as const;
    for (const scenario of supports) {
      test(`${scenario.target} ${scenario.effect} permits own/enemy compatible models, filters wrong kinds and updates cube colors`, async ({ page }) => {
        const game = fixture(), card = prepare(game, scenario.name); prepare(game, scenario.name, 'rapid');
        for (const id of scenario.choices) wound(game, id, { p3: game.players.some(p => p.id === id) ? 4 : 1 });
        syncCubes(game);
        const wire = await mount(page, game);
        await expectModels(page, wire.state);
        for (const [index, id] of scenario.choices.entries()) {
          const slot: Slot = index === 0 ? 'slot1' : 'rapid';
          const button = prepared(page, scenario.name, slot);
          const amount = card[scenario.effect]!;
          await expect(button.locator(`.${scenario.effect}-effect`)).toContainText(`${amount} ${scenario.effect}`);
          if (scenario.effect === 'convert') await expect(button.locator('.convert-effect')).toContainText('damage cubes');
          await button.click(); await noDummy(page); await hex(page).click();
          await expectOptions(page, [...scenario.ids]); await expect(targetSelect(page)).toHaveValue('');
          await targetSelect(page).selectOption(id);
          const before = wire.state, mage = before.players.some(p => p.id === id);
          const initial = modelAt(before, id).damageCubes, changed = Math.min(initial, amount);
          const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot,
            ...(mage ? { targetPlayerId: id } : { targetEvocationId: id }) });
          expect(modelAt(after, id)).toMatchObject({ damageCubes: scenario.effect === 'heal' ? initial - changed : initial });
          expect(modelAt(after, id).damageByPlayer).toEqual({ ...(initial > changed ? { p3: initial - changed } : {}),
            ...(scenario.effect === 'convert' ? { p1: changed } : {}) });
          expect(after.players[2].cubes.available).toBe(before.players[2].cubes.available + changed);
          expect(after.players[0].cubes.available).toBe(before.players[0].cubes.available - (scenario.effect === 'convert' ? changed : 0));
          for (const p of before.players.filter(p => p.id !== id)) expect(after.players.find(t => t.id === p.id)!.wizard).toEqual(p.wizard);
          for (const e of before.evocations.filter(e => e.id !== id)) expect(after.evocations.find(t => t.id === e.id)).toEqual(e);
          expect(after.board).toEqual(before.board);
        }
        expect(wire.replies.map(r => r.action.type)).toEqual(['CAST_SPELL', 'CAST_SPELL']);
      });
    }

    for (const name of ['Renewing Word', "Summoner's Balm", 'Vital Thread']) {
      test(`${name} uses actual model positions at the range boundary and invalidates stale off-axis/distant/protected targets`, async ({ page }) => {
        const game = fixture(), card = prepare(game, name);
        game.players[0].wizard.position = { q: -1, r: 0 };
        const boundary = { q: card.range - 1, r: 0 }, offAxis = { q: 1, r: 1 }, distant = { q: 3, r: 0 };
        const room = roomAt(game, 'room-1,0');
        for (const id of ['room-2,0', 'room-1,1']) {
          room.tiles.push(...roomAt(game, id).tiles); game.board.rooms = game.board.rooms.filter(r => r.id !== id);
        }
        room.tiles.push(distant);
        const start = game.board.rooms.find(r => r.startingFor === 'p4')!, protectedPosition = { q: -1, r: 1 };
        game.board.rooms = game.board.rooms.filter(r => r.id !== 'room--1,1'); start.tiles = [protectedPosition];
        game.players[1].wizard.position = { ...boundary }; game.players[2].wizard.position = { ...offAxis };
        game.players[3].wizard.position = { ...protectedPosition };
        game.evocations = [evocation('legal', 'p2', boundary), evocation('off-axis', 'p3', offAxis), evocation('protected', 'p4', protectedPosition)];
        const wire = await mount(page, game);
        await prepared(page, name).click(); await noDummy(page); await hex(page, room.id).click();
        const options = card.target === 'MAGE' ? ['p2'] : card.target === 'EVOCATION' ? ['legal'] : ['p2', 'legal'];
        await expectOptions(page, options); await expect(hex(page, room.id)).toHaveClass(/reachable/);
        await targetSelect(page).selectOption(options[0]);
        for (const position of [offAxis, distant]) {
          const moved = structuredClone(wire.state);
          moved.players[1].wizard.position = { ...position }; moved.evocations[0].position = { ...position }; wire.update(moved);
          // The room still has a tile in range, but its models do not: no stale selection may cast.
          await expectOptions(page, []); await expect(castButton(page)).toBeDisabled();
          await expect(hex(page, room.id)).not.toHaveClass(/reachable/);
        }
        await hex(page, start.id).click(); await expectOptions(page, []);
        await expect(castButton(page)).toBeDisabled(); await expect(hex(page, start.id)).not.toHaveClass(/reachable/);
        expect(wire.replies).toHaveLength(0);
        wire.update(game); await hex(page, room.id).click(); await expectOptions(page, options);
        await expect(targetSelect(page)).toHaveValue('');
        const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1',
          ...(card.target === 'EVOCATION' ? { targetEvocationId: 'legal' } : { targetPlayerId: 'p2' }) });
        expect(after.players.map(p => p.wizard)).toEqual(game.players.map(p => p.wizard));
        expect(after.evocations).toEqual(game.evocations); // A legal zero-effect default still spends its card/action.
      });
    }

    test('ROOM support accepts an empty in-range room, but not off-axis, distant or protected rooms', async ({ page }) => {
      const game = fixture(); prepare(game, 'Restorative Tide');
      const start = game.board.rooms.find(r => r.startingFor === 'p4')!;
      game.board.rooms = game.board.rooms.filter(r => r.id !== 'room-0,-1'); start.tiles = [{ q: 0, r: -1 }];
      roomAt(game, 'room-2,0').tiles = [{ q: 3, r: 0 }];
      const wire = await mount(page, game);
      await prepared(page, 'Restorative Tide').click(); await noDummy(page);
      for (const id of ['room-1,1', 'room-2,0', start.id]) {
        await hex(page, id).click();
        await expect(hex(page, id)).not.toHaveClass(/reachable/);
        await expect(castButton(page)).toBeDisabled(); await expect(targetSelect(page)).toHaveCount(0);
      }
      expect(wire.replies).toHaveLength(0);
      await hex(page, 'room-1,0').click(); await expect(hex(page, 'room-1,0')).toHaveClass(/reachable/);
      await expect(targetSelect(page)).toHaveCount(0);
      const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: 'room-1,0' });
      expect(after.players.map(p => p.wizard)).toEqual(game.players.map(p => p.wizard)); expect(after.evocations).toEqual(game.evocations);
      expect(roomAt(after, 'room-1,0')).toMatchObject({ instability: 1, cubesByPlayer: { p1: 1 } });
      await expectRoomCubes(page, roomAt(after, 'room-1,0'));
    });

    test('ROOM healing reaches all friendly/enemy models across its tiles, returns cubes and leaves outsiders/room cubes unchanged', async ({ page }) => {
      const game = fixture(); prepare(game, 'Sanctuary');
      const room = roomAt(game), adjoining = roomAt(game, 'room-1,0');
      room.tiles.push(...adjoining.tiles); game.board.rooms = game.board.rooms.filter(r => r.id !== adjoining.id);
      game.players[1].wizard.position = { q: 1, r: 0 }; game.evocations[1].position = { q: 1, r: 0 };
      room.instability = 2; room.cubesByPlayer = { p2: 1, p4: 1 };
      wound(game, 'p1', { p3: 3 }); wound(game, 'p2', { p4: 1 }); wound(game, 'p3', { p4: 2 });
      wound(game, 'own-one', { p4: 1 }); wound(game, 'enemy-one', { p3: 1 });
      game.evocations.push(evocation('outside', 'p2', { q: 0, r: 1 }, 2)); wound(game, 'outside', { p4: 1 }); syncCubes(game);
      const wire = await mount(page, game); await expectModels(page, game);
      await prepared(page, 'Sanctuary').click(); await noDummy(page); await hex(page).click();
      await expect(targetSelect(page)).toHaveCount(0);
      await expect(prepared(page, 'Sanctuary').locator('.heal-effect')).toHaveText('♥ 2 heal');
      const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: room.id });
      expect(after.players.slice(0, 2).map(p => p.wizard.damageCubes)).toEqual([1, 0]);
      expect(after.evocations.map(e => e.damageCubes)).toEqual([0, 0, 1]);
      expect(after.players[2].wizard).toEqual(game.players[2].wizard);
      expect(after.evocations[2]).toEqual(game.evocations[2]); expect(after.board).toEqual(game.board);
      expect(after.players[2].cubes).toEqual({ available: 24, onWizard: 1, onEvocations: 0, onBoard: 0 });
      expect(after.players[3].cubes).toEqual({ available: 21, onWizard: 2, onEvocations: 1, onBoard: 1 });
      await expectRoomCubes(page, roomAt(after));
    });

    for (const status of ['partial', 'full', 'rebuilt'] as const) {
      test(`ROOM conversion changes only live room cubes (${status}), never mage/evocation wounds or historical ownership`, async ({ page }) => {
        const game = fixture(); prepare(game, 'Rewrite the Lodge');
        const room = roomAt(game); room.instability = status === 'partial' ? 5 : room.instabilityLimit;
        room.cubesByPlayer = { p1: 1, p2: 2, p3: 1, [BLACK_ROSE_ID]: room.instability - 4 };
        room.reconstructed = room.scored = status === 'rebuilt';
        wound(game, 'p2', { p4: 2 }); wound(game, 'own-one', { p3: 1 }); syncCubes(game);
        const wire = await mount(page, game); await expectModels(page, game);
        await prepared(page, 'Rewrite the Lodge').click(); await noDummy(page); await hex(page).click();
        await expect(targetSelect(page)).toHaveCount(0);
        await expect(prepared(page, 'Rewrite the Lodge').locator('.convert-effect')).toHaveText('↻ 3 convert · room cubes');
        const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: room.id });
        const converted = roomAt(after);
        expect(after.players.map(p => p.wizard)).toEqual(game.players.map(p => p.wizard)); expect(after.evocations).toEqual(game.evocations);
        expect(converted).toMatchObject({ instability: room.instability, reconstructed: room.reconstructed, scored: room.scored });
        expect(after.blackRose).toEqual(game.blackRose);
        expect(after.players.map(p => [p.victoryPoints, p.kills])).toEqual(game.players.map(p => [p.victoryPoints, p.kills]));
        if (status === 'rebuilt') {
          expect(converted).toEqual(room); expect(after.players.map(p => p.cubes)).toEqual(game.players.map(p => p.cubes));
          await expect(page.locator('.room-detail .contributions')).toHaveCount(0);
        } else {
          expect(converted.cubesByPlayer).toEqual({ p1: 4, [BLACK_ROSE_ID]: room.instability - 4 });
          expect(after.players[0].cubes).toEqual({ available: 21, onWizard: 0, onEvocations: 0, onBoard: 4 });
          expect(after.players[1].cubes.available).toBe(25); expect(after.players[2].cubes.available).toBe(24);
          await expect(page.locator('.room-detail .contributions')).toContainText('Rose Warden: 4');
          await expect(page.locator('.room-detail .contributions')).not.toContainText(/Blue Seer|Amber Sage/);
          if (status === 'full') await expect(page.locator('.room-detail')).toContainText('Full: locked to new cubes; rebuilds at Cleanup');
        }
        await expectRoomCubes(page, converted);
      });
    }

    test('switching support/Combat clears typed selections and dummy state, but the legacy Cantrip dummy still places instability without damage', async ({ page }) => {
      const game = fixture(); prepare(game, 'Splinter Hex'); prepare(game, 'Vital Thread', 'rapid');
      wound(game, 'p1', { p3: 2 }); wound(game, 'own-one', { p3: 1 }); syncCubes(game);
      const wire = await mount(page, game), support = prepared(page, 'Vital Thread', 'rapid'), offense = prepared(page, 'Splinter Hex');
      await support.click(); await noDummy(page); await hex(page).click();
      await expectOptions(page, ['p1', 'p2', 'own-one', 'enemy-one']); await targetSelect(page).selectOption('own-one');
      await offense.click(); await expect(page.locator('.room-detail,.hex.selected')).toHaveCount(0);
      await hex(page).click(); await expectOptions(page, ['p2', 'enemy-one']); await expect(targetSelect(page)).toHaveValue('');
      await page.getByRole('button', { name: 'Target dummy · no damage', exact: true }).click();
      await hex(page).click(); await expect(castButton(page)).toHaveText('Cast Splinter Hex here on dummy');
      await expect(targetSelect(page)).toHaveCount(0);
      await support.click(); await noDummy(page); await expect(page.locator('.room-detail,.hex.selected')).toHaveCount(0);
      await hex(page).click(); await expectOptions(page, ['p1', 'p2', 'own-one', 'enemy-one']); await expect(targetSelect(page)).toHaveValue('');
      const healed = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p1' });
      expect(healed.players[0].wizard.damageCubes).toBe(0); expect(healed.evocations[0].damageCubes).toBe(1);
      await offense.click(); await page.getByRole('button', { name: 'Target dummy · no damage', exact: true }).click(); await hex(page).click();
      const after = await cast(page, wire, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: 'room-0,0', dummy: true });
      expect(after.players.map(p => p.wizard)).toEqual(healed.players.map(p => p.wizard)); expect(after.evocations).toEqual(healed.evocations);
      expect(roomAt(after)).toMatchObject({ instability: 1, cubesByPlayer: { p1: 1 } });
      await expectRoomCubes(page, roomAt(after));
    });
  });
}