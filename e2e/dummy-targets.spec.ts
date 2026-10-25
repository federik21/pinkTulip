import { test, expect, type Locator, type Page, type TestInfo, type WebSocketRoute } from '@playwright/test';
import { applyAction, BLACK_ROSE_ID, createGame, getSpellType } from '../packages/game-engine/src/index';
import type { Card, Evocation, GameAction, GameState } from '../packages/game-engine/src/index';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { closeChronicle, closeControls, openChronicle, pressHistory, selectControlTab, selectSpells } from './layout-ui';

type Cast = Extract<GameAction, { type: 'CAST_SPELL' }>;
type Slot = Cast['slot'];
type Request = { action: GameAction; requestId: string };
type Reply = Request & { before: GameState; after: GameState };
const center = 'room-0,0', empty = 'room-1,0';
const faults = new WeakMap<Page, string[]>(), offline = new WeakSet<Page>();
const room = (game: GameState, id = center) => game.board.rooms.find(candidate => candidate.id === id)!;
const hex = (page: Page, id = center) => page.locator(`.hex[data-room-id="${id}"]`);
const prepared = (page: Page, slot: Slot = 'slot1') => page.locator('.prepared .spell').filter({
  has: page.locator('.eyebrow', { hasText: slot === 'rapid' ? /\bQuick\b/ : new RegExp(`^Spell ${slot.slice(-1)}\\b`) }),
});
const targetSelect = (page: Page) => page.getByRole('combobox', { name: 'Spell target model', exact: true });
const modelMode = (page: Page) => page.getByRole('button', { name: 'Target model', exact: true });
const dummyMode = (page: Page) => page.getByRole('button', { name: 'Target dummy · no damage', exact: true });
const confirm = (page: Page) => page.locator('.room-detail').getByRole('button', { name: /^(Cast|Activate) / });
const undo = (page: Page) => page.getByRole('button', { name: 'Undo action', exact: true });
// Hidden-but-mounted dashboard buttons: lets disabled-state checks run without opening the dock.
const undoAny = (page: Page) => page.getByRole('button', { name: 'Undo action', exact: true, includeHidden: true });
const redo = (page: Page) => page.getByRole('button', { name: 'Redo action', exact: true });

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
test.afterEach(async ({ page }) => {
  expect(faults.get(page), 'No browser errors or rejected authoritative commands').toEqual([]);
  if (offline.has(page)) await expect(page.getByRole('alert')).toHaveText('Connection closed. Reload to reconnect to your room.');
  else await expect(page.getByRole('alert')).toHaveCount(0);
});

function take(game: GameState, name: string): Card {
  for (const deck of game.library) {
    const index = deck.cards.findIndex(card => card.name === name);
    if (index >= 0) return deck.cards.splice(index, 1)[0];
  }
  throw new Error(`Missing canonical physical dummy-test card: ${name}`);
}
function prepare(game: GameState, name: string, slot: Slot = 'slot1', owner = 'p1') {
  const player = game.players.find(candidate => candidate.id === owner)!;
  expect(player.prepared[slot]).toBeNull();
  const card = take(game, name); player.prepared[slot] = { card, used: false }; return card;
}
function servant(id: string, playerId: string, contributor: string): Evocation {
  return { id, playerId, number: 1, name: 'Cadaver', archetype: 'UNDEAD', movement: 2, attack: 2,
    health: 2, passive: 'WOUNDED_FURY', position: { q: 0, r: 0 }, damageCubes: 1,
    damageByPlayer: { [contributor]: 1 }, activated: false };
}
function turn(game: GameState, playerId = 'p1') {
  game.currentPlayerId = playerId; game.evocationActivation = null;
  game.activation = { playerId, actionsUsed: 0, spellsCast: 0, exploring: 0,
    sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false, physicalAction: null };
}
function syncCubes(game: GameState) {
  for (const player of game.players) {
    player.cubes.onWizard = game.players.reduce((sum, target) => sum + (target.wizard.damageByPlayer[player.id] ?? 0), 0);
    player.cubes.onEvocations = game.evocations.reduce((sum, target) => sum + (target.damageByPlayer[player.id] ?? 0), 0);
    player.cubes.onBoard = game.board.rooms.filter(target => !target.scored && !target.reconstructed)
      .reduce((sum, target) => sum + (target.cubesByPlayer[player.id] ?? 0), 0);
    player.cubes.available = 25 - player.cubes.onWizard - player.cubes.onEvocations - player.cubes.onBoard;
  }
}
function fixture(evocations = true): GameState {
  const game = createGame(4); game.gameId = 'dummy-targets'; game.round = 1; game.phase = 'ACTION';
  game.firstPlayerId = 'p1'; turn(game);
  game.players.forEach((player, index) => {
    player.name = ['Rose Warden', 'Blue Seer', 'Amber Sage', 'Green Mage'][index];
    player.connected = player.ready = true;
    player.wizard.position = { q: 0, r: index < 2 ? 0 : index - 1 };
  });
  Object.assign(game.players[0].wizard, { damageCubes: 4, blackDamage: 1, damageByPlayer: { p2: 2, [BLACK_ROSE_ID]: 1 } });
  Object.assign(game.players[1].wizard, { damageCubes: 4, damageByPlayer: { p3: 3 } }); // One unattributed wound.
  game.evocations = evocations ? [servant('own-one', 'p1', 'p2'), servant('enemy-one', 'p2', 'p3')] : [];
  game.board.rooms.forEach((target, index) => { target.name = target.id === center ? 'Rose Chamber' : `Dummy Chamber ${index + 1}`; });
  Object.assign(room(game), { instability: 2, cubesByPlayer: { p2: 1, [BLACK_ROSE_ID]: 1 } });
  Object.assign(room(game, empty), { instability: 1, cubesByPlayer: { p2: 1 } });
  // Reserve real, distinct stock, never fabricate cards or feed masked state to the reducer.
  game.players[0].personalDeck.push(take(game, 'Distant Tremor'));
  game.players[1].personalDeck.push(take(game, 'Nova'));
  game.players[1].hand.push(take(game, 'Ember Lance'));
  game.players[1].studyCardIds = game.players[1].hand.map(card => card.id);
  prepare(game, 'Fracture', 'slot1', 'p2');
  syncCubes(game); return game;
}
function physicalCards(game: GameState) {
  return [...game.library.flatMap(deck => [...deck.cards, ...deck.discard]), ...game.powerfulDeck, ...game.removedCards,
    ...[...game.readiedSpells ?? [], ...game.ongoingSpells ?? []].map(active => active.card),
    ...game.players.flatMap(player => [...player.hand, ...player.personalDeck, ...player.discard,
      ...Object.values(player.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])]
    .map(card => card.id).sort();
}
function conserved(game: GameState, cards: string[]) {
  expect(cards).toHaveLength(120); expect(new Set(cards).size).toBe(120);
  expect(physicalCards(game)).toEqual(cards);
  const expected = structuredClone(game); syncCubes(expected);
  for (const [index, player] of game.players.entries()) {
    expect(player.cubes).toEqual(expected.players[index].cubes);
    expect(Object.values(player.cubes).every(value => Number.isInteger(value) && value >= 0)).toBe(true);
    expect(Object.values(player.cubes).reduce((sum, value) => sum + value, 0)).toBe(25);
  }
}
function expectProjection(game: GameState, history: ActionHistory, viewer: string | null) {
  const visible = publicState(game, viewer, history);
  expect(visible.history).toEqual(history.status(game, viewer));
  expect(Object.keys(visible.history!).every(key => ['canUndo', 'canRedo', 'undoLabel', 'redoLabel'].includes(key))).toBe(true);
  expect(visible.eventDeck).toEqual([]); expect(visible.questDeck).toEqual([]);
  const hidden = (cards: Card[]) => cards.forEach(card => expect(card).toEqual({
    id: expect.stringMatching(/^hidden-\d+$/), name: 'Hidden spell', kind: 'SPELL',
    damage: 0, instability: 0, range: 0, target: 'MODEL',
  }));
  hidden(visible.powerfulDeck);
  expect(visible.powerfulDeck).toHaveLength(game.powerfulDeck.length);
  for (const deck of visible.library) {
    const original = game.library.find(candidate => candidate.id === deck.id)!;
    hidden(deck.cards); expect(deck.cards).toHaveLength(original.cards.length); expect(deck.discard).toEqual(original.discard);
  }
  for (const player of visible.players) {
    const original = game.players.find(candidate => candidate.id === player.id)!;
    hidden(player.personalDeck); expect(player.personalDeck).toHaveLength(original.personalDeck.length);
    if (player.id === viewer) {
      expect(player.hand).toEqual(original.hand); expect(player.prepared).toEqual(original.prepared);
    } else {
      hidden(player.hand); expect(player.hand).toHaveLength(original.hand.length);
      expect(player.quest).toBeNull(); expect(player.additionalQuests).toEqual([]);
      expect(player).not.toHaveProperty('studyCardIds');
      for (const slot of ['slot1', 'slot2', 'slot3', 'rapid'] as const) {
        if (original.prepared[slot]) {
          expect(player.prepared[slot]!.used).toBe(original.prepared[slot]!.used);
          hidden([player.prepared[slot]!.card]);
        } else expect(player.prepared[slot]).toBeNull();
      }
    }
  }
  expect(visible.readiedSpells).toEqual(game.readiedSpells?.map((active, index) => active.playerId === viewer ? active : {
    id: active.id, playerId: active.playerId, card: { id: `hidden-${index}`, name: 'Hidden spell', kind: 'SPELL',
      damage: 0, instability: 0, range: 0, target: 'MODEL', ...(active.card.spellType ? { spellType: active.card.spellType } : {}) },
  }));
  expect(visible.ongoingSpells).toEqual(game.ongoingSpells); expect(visible.activeSpellOrder).toEqual(game.activeSpellOrder);
  expect(visible.log).toEqual(game.log); return visible;
}

async function mount(page: Page, initial: GameState) {
  let game = structuredClone(initial), socket: WebSocketRoute | undefined, held = false;
  const history = new ActionHistory(), cards = physicalCards(game);
  const requests: Request[] = [], replies: Reply[] = [], acknowledgements: string[] = [];
  conserved(game, cards);
  const publish = () => {
    const before = structuredClone(game);
    for (const viewer of [...game.players.map(player => player.id), null]) expectProjection(game, history, viewer);
    expect(game).toEqual(before);
    socket!.send(JSON.stringify({ type: 'STATE', state: publicState(game, 'p1', history) }));
  };
  await page.routeWebSocket('**', route => {
    socket = route;
    route.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: game.gameId })); publish();
      } else if (message.action) {
        requests.push(message);
        try {
          expect(message.action.playerId).toBe('p1'); expect(message.requestId).toEqual(expect.any(String));
          const before = game;
          // ActionHistory calls the real applyAction and intercepts only server-owned undo/redo.
          game = history.apply(game, message.action, 'p1'); conserved(game, cards);
          replies.push({ ...message, before, after: game }); publish();
          if (held) acknowledgements.push(message.requestId);
          else route.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: message.requestId }));
        } catch (error) {
          faults.get(page)!.push(`Engine rejected ${JSON.stringify(message.action)}: ${String(error)}`);
          route.send(JSON.stringify({ type: 'ERROR', requestId: message.requestId, message: String(error) }));
        }
      }
    });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.locator('.app')).toBeVisible();
  const overlay = page.locator('.phase-overlay');
  await expect(overlay).toBeVisible(); await overlay.click(); await expect(overlay).toBeHidden();
  await selectSpells(page);
  return { requests, replies, history, get state() { return game; },
    replace(state: GameState) { conserved(state, cards); history.clear(); game = structuredClone(state); publish(); },
    holdAcknowledgements() { held = true; },
    wrongAcknowledgement() { socket!.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: 'not-the-pending-dummy-cast' })); },
    releaseAcknowledgements() {
      held = false;
      for (const requestId of acknowledgements.splice(0)) socket!.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId }));
    },
    close() { offline.add(page); socket!.close({ code: 1000, reason: 'Dummy-target offline fixture' }); },
  };
}
type Wire = Awaited<ReturnType<typeof mount>>;
async function command(page: Page, wire: Wire, click: () => Promise<unknown>, expected: GameAction) {
  const index = wire.replies.length;
  await click(); await expect.poll(() => wire.replies.length).toBe(index + 1);
  const reply = wire.replies[index]; expect(reply.action).toEqual(expected);
  expect(wire.requests[index]).toEqual({ action: expected, requestId: reply.requestId });
  expect(new Set(wire.requests.map(request => request.requestId)).size).toBe(wire.requests.length);
  await expect(page.getByRole('alert')).toHaveCount(0); return reply;
}
async function expectModes(page: Page, dummy: boolean) {
  await expect(page.locator('.target-mode')).toHaveCount(1);
  await expect(modelMode(page)).toHaveAttribute('aria-pressed', String(!dummy));
  await expect(dummyMode(page)).toHaveAttribute('aria-pressed', String(dummy));
  if (dummy) {
    await expect(targetSelect(page)).toHaveCount(0);
    await expect(page.locator('.dummy-target-help')).toHaveText('Select any non-starting room in range on a straight hex line, occupied or empty. Only printed room instability resolves. Damage, healing, conversion and model-bound effects are ignored. The spell still costs its card and 1 turn action.');
  } else await expect(page.locator('.dummy-target-help')).toHaveCount(0);
}
async function expectOptions(page: Page, ids: string[]) {
  await expect(targetSelect(page)).toBeVisible();
  await expect(targetSelect(page).locator('option')).toHaveCount(ids.length + 1);
  expect(await targetSelect(page).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
    .toEqual(['', ...ids]);
  await expect(targetSelect(page).locator('option').first()).toHaveText('First eligible model in this room');
}
async function chooseDummy(page: Page, slot: Slot, id: string, card: Card, realOptions?: string[]) {
  await selectSpells(page);
  const button = prepared(page, slot);
  await expect(button).toBeEnabled();
  // A connection-only broadcast preserves local targeting; reopen explicitly so
  // this helper starts in real mode even after the paused-state guard case.
  if (await button.getAttribute('aria-pressed') === 'true') { await button.click(); await selectSpells(page); }
  await button.click(); await expectModes(page, false);
  await hex(page).click();
  await expect(confirm(page)).toHaveText(`${getSpellType(card) === 'PROTECTION' ? 'Activate' : 'Cast'} ${card.name} here`);
  if (realOptions) {
    await expectOptions(page, realOptions);
    await expect(targetSelect(page)).toHaveValue('');
    if (realOptions.length) await expect(confirm(page)).toBeEnabled();
    else await expect(confirm(page)).toBeDisabled();
  }
  await dummyMode(page).click(); await expectModes(page, true);
  await expect(page.locator('.room-detail,.hex.selected')).toHaveCount(0);
  await hex(page, id).click(); await expect(hex(page, id)).toHaveClass(/reachable/);
  await expect(confirm(page)).toHaveText(`Cast ${card.name} here on dummy`); await expect(confirm(page)).toBeEnabled();
}
function noModelEffects(before: GameState, after: GameState) {
  expect(after.players.map(player => player.wizard)).toEqual(before.players.map(player => player.wizard));
  expect(after.evocations).toEqual(before.evocations); expect(after.feedbackEvents).toEqual(before.feedbackEvents);
  expect(after.readiedSpells).toEqual(before.readiedSpells); expect(after.ongoingSpells).toEqual(before.ongoingSpells);
  expect(after.activeSpellOrder).toEqual(before.activeSpellOrder);
  expect(after.players.map(player => [player.kills, player.victoryPoints, player.questsCompleted]))
    .toEqual(before.players.map(player => [player.kills, player.victoryPoints, player.questsCompleted]));
  expect(after.blackRose).toEqual(before.blackRose);
}
function dummyCost(reply: Reply, card: Card, id: string, slot: Slot) {
  const { before, after } = reply;
  expect(after.players[0].prepared[slot]).toEqual({ card, used: true });
  expect(after.players.map(player => player.actionTokens)).toEqual(before.players.map(player => player.actionTokens));
  expect(after.players.map(player => player.discard)).toEqual(before.players.map(player => player.discard));
  const library = structuredClone(before.library); library.find(deck => deck.id === card.schoolId)!.discard.push(card);
  expect(after.library).toEqual(library); expect(after.removedCards).toEqual(before.removedCards);
  const board = structuredClone(before.board), target = board.rooms.find(candidate => candidate.id === id)!;
  target.instability += card.instability;
  if (card.instability) target.cubesByPlayer.p1 = (target.cubesByPlayer.p1 ?? 0) + card.instability;
  expect(after.board).toEqual(board);
  expect(after.players[0].cubes).toEqual({ ...before.players[0].cubes,
    available: before.players[0].cubes.available - card.instability, onBoard: before.players[0].cubes.onBoard + card.instability });
  expect(after.players.slice(1).map(player => player.cubes)).toEqual(before.players.slice(1).map(player => player.cubes));
  const additions = [`Rose Warden casts ${card.name} on a dummy (no model effects) for 1 action (no physical token).`];
  if (card.instability) additions.push(`Rose Warden places ${card.instability} instability in ${target.name} (${target.instability}/${target.instabilityLimit}).`);
  if (after.currentPlayerId !== before.currentPlayerId) {
    additions.push(`${after.players.find(player => player.id === after.currentPlayerId)!.name} takes a turn: 2 actions total across physical actions, spell casts, and discard-to-move.`);
  }
  expect(after.log).toEqual([...before.log, ...additions]);
  expect(after.log.join('\n')).not.toMatch(/activates a hidden spell|on a dummy \(no damage\)/);
  expect(physicalCards(after)).toEqual(physicalCards(before)); noModelEffects(before, after);
}
async function undoRedo(page: Page, wire: Wire, before: GameState, after: GameState) {
  await selectControlTab(page, 'Physical actions');
  await expect(undo(page)).toBeEnabled();
  await command(page, wire, () => undo(page).click(), { type: 'UNDO_ACTION', playerId: 'p1' });
  expect(wire.state).toEqual(before);
  await expect(page.locator('.prepared .spell.chosen,.target-mode,.dummy-target-help')).toHaveCount(0);
  await expect(targetSelect(page)).toHaveCount(0); await expect(confirm(page)).toHaveCount(0);
  await expect(redo(page)).toBeEnabled();
  await command(page, wire, () => redo(page).click(), { type: 'REDO_ACTION', playerId: 'p1' });
  expect(wire.state).toEqual(after); await expect(undo(page)).toBeEnabled();
  await closeControls(page);
}
async function screenshot(info: TestInfo, name: string, locator: Locator) {
  await info.attach(name, { body: await locator.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' }), contentType: 'image/png' });
}
async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

const canonical = [
  { name: 'Renewing Word', target: 'MAGE', evocations: true },
  { name: "Mage's Due", target: 'MAGE', evocations: true },
  { name: "Summoner's Balm", target: 'EVOCATION', evocations: true },
  { name: 'Reclaimed Servant', target: 'EVOCATION', evocations: false },
  { name: 'Mending Ward', target: 'MAGE', evocations: true },
  { name: "Servant's Safeguard", target: 'EVOCATION', evocations: false },
  { name: 'Thorned Path', target: 'MAGE', evocations: true },
] as const;

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px expanded dummy targets`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });

    for (const scenario of canonical) {
      test(`${scenario.name}: occupied and empty dummy casts spend numbered/Quick actions, not models, bindings or tokens${scenario.evocations ? '' : ' even with no evocations'}`, async ({ page }, info) => {
        const initial = fixture(scenario.evocations);
        const numbered = prepare(initial, scenario.name), quick = prepare(initial, scenario.name, 'rapid');
        expect(numbered.target).toBe(scenario.target); expect(quick.target).toBe(scenario.target);
        initial.players[0].actionTokens = 0;
        const wire = await mount(page, initial);
        for (const [index, slot] of (['slot1', 'rapid'] as const).entries()) {
          const id = index === 0 ? center : empty, card = index === 0 ? numbered : quick;
          expect(initial.players.some(player => room(initial, id).tiles.some(tile =>
            tile.q === player.wizard.position.q && tile.r === player.wizard.position.r))).toBe(index === 0);
          await chooseDummy(page, slot, id, card, scenario.target === 'MAGE' ? ['p1', 'p2'] : scenario.evocations ? ['own-one', 'enemy-one'] : []);
          if (!scenario.evocations) {
            expect(wire.state.evocations).toEqual([]); await expect(page.locator('.evocation-marker')).toHaveCount(0);
          }
          if (index === 0 && ['Renewing Word', "Servant's Safeguard", 'Thorned Path'].includes(scenario.name)) {
            await selectSpells(page);
            await screenshot(info, `dummy-${card.schoolId}-${scenario.target}-${viewport.width}`, page.locator('#controls-panel-spells'));
            await closeControls(page);
            await screenshot(info, `dummy-confirm-${scenario.target}-${viewport.width}`, page.locator('.room-detail'));
          }
          const reply = await command(page, wire, () => confirm(page).click(),
            { type: 'CAST_SPELL', playerId: 'p1', slot, roomId: id, dummy: true });
          dummyCost(reply, card, id, slot);
          await expect(prepared(page, slot)).toHaveClass(/used/);
          await expect(page.locator('.prepared .spell.chosen')).toHaveCount(0);
          await expect(page.locator('.board .model-effect-markers,.model-effects .model-effect,.feedback-pulse')).toHaveCount(0);
          if (index === 0) {
            expect(wire.state.activation).toMatchObject({ playerId: 'p1', actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: true });
            await expect(prepared(page, 'rapid')).toBeEnabled();
            await expect(page.locator('.phase-panel .badge')).toHaveText('1 turn actions left');
          } else {
            expect(wire.state.currentPlayerId).toBe('p2');
            await expect(page.locator('.phase-panel .badge')).toHaveText('Waiting');
            await expect(page.locator('.prepared .spell:enabled')).toHaveCount(0);
          }
          await undoRedo(page, wire, reply.before, reply.after);
          await selectSpells(page);
          await expect(page.getByRole('region', { name: 'Active and ongoing spells', exact: true })).toHaveCount(0);
        }
        const dialog = await openChronicle(page);
        await expect(dialog.getByRole('log').locator(':scope > div').filter({ hasText: `${scenario.name} on a dummy (no model effects)` })).toHaveCount(2);
        await closeChronicle(page);
        expect(wire.requests.map(request => request.action.type)).toEqual([
          'CAST_SPELL', 'UNDO_ACTION', 'REDO_ACTION', 'CAST_SPELL', 'UNDO_ACTION', 'REDO_ACTION',
        ]);
      });
    }

    test('mode/card toggles restore typed real options without stale fields; quick dummy confirmation enforces room guards and printed instability', async ({ page }, info) => {
      const initial = fixture(), offense = prepare(initial, 'Splinter Hex'), support = prepare(initial, "Summoner's Balm", 'rapid');
      prepare(initial, 'Mending Ward', 'slot2');
      initial.players[0].wizard.position = { q: -1, r: 0 };
      const start = room(initial, initial.players[3].wizard.startingRoomId);
      initial.board.rooms = initial.board.rooms.filter(target => target.id !== 'room-0,-1'); start.tiles = [{ q: 0, r: -1 }];
      const wire = await mount(page, initial);
      await prepared(page).click(); await hex(page).click(); await expectOptions(page, ['p2', 'enemy-one']);
      await targetSelect(page).selectOption('enemy-one'); await dummyMode(page).click(); await expectModes(page, true);
      await hex(page, empty).click(); await expect(confirm(page)).toBeEnabled();
      await modelMode(page).click(); await expectModes(page, false);
      await expect(page.locator('.room-detail,.hex.selected')).toHaveCount(0);
      await hex(page, empty).click(); await expectOptions(page, []); await expect(confirm(page)).toBeDisabled();
      await hex(page).click(); await expectOptions(page, ['p2', 'enemy-one']); await expect(targetSelect(page)).toHaveValue('');
      await targetSelect(page).selectOption('enemy-one');
      await selectSpells(page); await prepared(page, 'rapid').click(); await expectModes(page, false);
      await expect(page.locator('.room-detail,.hex.selected')).toHaveCount(0);
      await hex(page).click(); await expectOptions(page, ['own-one', 'enemy-one']);
      await targetSelect(page).selectOption('own-one'); await dummyMode(page).click(); await expectModes(page, true);
      await hex(page, empty).click(); await modelMode(page).click(); await hex(page).click();
      await expectOptions(page, ['own-one', 'enemy-one']); await expect(targetSelect(page)).toHaveValue('');
      const healed = await command(page, wire, () => confirm(page).click(),
        { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetEvocationId: 'own-one' });
      expect(healed.after.evocations[0]).toEqual({ ...healed.before.evocations[0], damageCubes: 0, damageByPlayer: {} });
      expect(healed.after.evocations[1]).toEqual(healed.before.evocations[1]);
      expect(healed.after.players.map(player => player.wizard)).toEqual(healed.before.players.map(player => player.wizard));
      expect(healed.after.board).toEqual(healed.before.board);
      expect(healed.after.players[0].prepared.rapid).toEqual({ card: support, used: true });
      await command(page, wire, () => pressHistory(page, 'Undo action'), { type: 'UNDO_ACTION', playerId: 'p1' });
      expect(wire.state).toEqual(initial);

      // Launch the same mounted controls through the dock; selection closes the dashboard.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.getByRole('button', { name: 'Open spells', exact: true }).click();
      await expect(page.locator('.control-banner')).toHaveClass(/is-floating/);
      await prepared(page).click(); await expect(page.locator('.control-banner')).not.toHaveClass(/is-floating/);
      await dummyMode(page).click(); await expectModes(page, true);
      const sent = wire.requests.length;
      for (const id of [start.id, 'room-1,1', 'room-2,0']) {
        await hex(page, id).click(); await expect(hex(page, id)).not.toHaveClass(/reachable/);
        await expect(confirm(page)).toBeDisabled(); await confirm(page).dispatchEvent('click');
      }
      expect(wire.requests).toHaveLength(sent);
      await hex(page, empty).click(); await expect(hex(page, empty)).toHaveClass(/reachable/);
      const confirmation = page.locator('.room-detail.quick-target');
      await expect(confirmation).toBeVisible(); await expect(confirm(page)).toHaveText('Cast Splinter Hex here on dummy');
      const bounds = await confirm(page).evaluate(element => {
        const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { visible: rect.top >= 0 && rect.bottom <= innerHeight, hit: !!hit && element.contains(hit) };
      });
      expect(bounds).toEqual({ visible: true, hit: true });
      await screenshot(info, `quick-dummy-confirm-${viewport.width}`, confirmation);
      const cast = await command(page, wire, () => confirm(page).click(),
        { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: empty, dummy: true });
      dummyCost(cast, offense, empty, 'slot1');
      expect(room(wire.state, empty)).toMatchObject({ instability: 2, cubesByPlayer: { p2: 1, p1: 1 } });
      await expect(hex(page, empty).locator('.capacity-fill[data-owner-id="p1"]')).toHaveAttribute('data-cubes', '1');
      await undoRedo(page, wire, cast.before, cast.after);
    });

    test('pending ACK, wrong ACK, peer/paused/physical/evocation states and offline cannot send another dummy command', async ({ page }) => {
      const initial = fixture(), card = prepare(initial, 'Renewing Word'); prepare(initial, "Summoner's Balm", 'rapid');
      const wire = await mount(page, initial);
      await chooseDummy(page, 'slot1', center, card); wire.holdAcknowledgements();
      await command(page, wire, () => confirm(page).click(),
        { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: center, dummy: true });
      await expect(prepared(page, 'rapid')).toBeDisabled(); await expect(undoAny(page)).toBeDisabled();
      await prepared(page, 'rapid').dispatchEvent('click'); await undoAny(page).dispatchEvent('click');
      wire.wrongAcknowledgement(); await frame(page);
      await expect(prepared(page, 'rapid')).toBeDisabled(); await expect(undoAny(page)).toBeDisabled();
      expect(wire.requests).toHaveLength(1);
      wire.releaseAcknowledgements(); await expect(prepared(page, 'rapid')).toBeEnabled();
      await command(page, wire, () => pressHistory(page, 'Undo action'), { type: 'UNDO_ACTION', playerId: 'p1' });
      expect(wire.state).toEqual(initial);
      const peerTurn = structuredClone(initial); turn(peerTurn, 'p2');
      const disconnected = structuredClone(initial); disconnected.players[1].connected = false;
      const physical = applyAction(initial, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
      const moving = applyAction(physical, { type: 'PERFORM_MOVEMENT', playerId: 'p1' });
      const evocation = applyAction(initial, { type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: 'own-one' });
      for (const blocked of [peerTurn, disconnected, physical, moving, evocation]) {
        wire.replace(initial); await chooseDummy(page, 'slot1', center, card);
        wire.replace(blocked); await selectSpells(page);
        await expect(page.locator('.prepared .spell:enabled')).toHaveCount(0);
        if (blocked === disconnected) await expect(page.getByText(/Game paused\. Waiting for the disconnected mage/)).toBeVisible();
        const keepsSelection = blocked === disconnected;
        await expect(page.locator('.prepared .spell.chosen')).toHaveCount(keepsSelection ? 1 : 0);
        if (keepsSelection) {
          await expect(confirm(page)).toBeDisabled(); await confirm(page).dispatchEvent('click');
        } else await expect(confirm(page)).toHaveCount(0);
        await prepared(page, 'rapid').dispatchEvent('click'); await frame(page);
        expect(wire.requests).toHaveLength(2); expect(wire.state).toEqual(blocked);
      }
      wire.replace(initial); await chooseDummy(page, 'slot1', empty, card); wire.close();
      await expect(page.locator('.header-meta')).toContainText('Offline');
      await expect(confirm(page)).toBeDisabled(); await expect(prepared(page, 'rapid')).toBeDisabled();
      await confirm(page).dispatchEvent('click'); await prepared(page, 'rapid').dispatchEvent('click'); await frame(page);
      expect(wire.requests).toHaveLength(2); expect(wire.state).toEqual(initial);
    });

    test('a dummy still emits native SPELL_CAST: hidden Spell Leech reveals, ongoing Arcane Feedback reacts and reveal blocks undo', async ({ page }) => {
      let initial = fixture(); const dummy = prepare(initial, "Summoner's Balm");
      prepare(initial, 'Mending Ward', 'rapid');
      prepare(initial, 'Arcane Feedback', 'rapid', 'p3'); turn(initial, 'p3');
      initial = applyAction(initial, { type: 'CAST_SPELL', playerId: 'p3', slot: 'rapid', targetPlayerId: 'p1' });
      prepare(initial, 'Spell Leech', 'rapid', 'p2'); turn(initial, 'p2');
      initial = applyAction(initial, { type: 'CAST_SPELL', playerId: 'p2', slot: 'rapid', roomId: center });
      turn(initial);
      const wire = await mount(page, initial), trap = initial.readiedSpells![0], ongoing = initial.ongoingSpells![0];
      const hidden = page.locator(`.readied-spell[data-active-spell-id="${trap.id}"]`);
      await expect(hidden.locator('strong')).toHaveText('Hidden active spell');
      await expect(hidden.locator('.spell-type')).toHaveAttribute('data-spell-type', 'TRAP');
      for (const secret of [trap.card.name, trap.card.id, trap.card.rulesText!, 'BOUND_ROOM', 'SPELL_CAST', 'roomId']) {
        expect(await hidden.evaluate(element => element.outerHTML)).not.toContain(secret);
      }
      await expect(page.locator(`.ongoing-spell[data-active-spell-id="${ongoing.id}"] strong`)).toHaveText('Arcane Feedback');
      await chooseDummy(page, 'slot1', empty, dummy);
      const { before, after } = await command(page, wire, () => confirm(page).click(),
        { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: empty, dummy: true });
      expect(after.players[0].wizard).toEqual({ ...before.players[0].wizard,
        damageCubes: before.players[0].wizard.damageCubes + 3,
        damageByPlayer: { ...before.players[0].wizard.damageByPlayer,
          p2: (before.players[0].wizard.damageByPlayer.p2 ?? 0) + 2,
          p3: (before.players[0].wizard.damageByPlayer.p3 ?? 0) + 1 } });
      expect(after.players.slice(1).map(player => player.wizard)).toEqual(before.players.slice(1).map(player => player.wizard));
      expect(after.evocations).toEqual(before.evocations); expect(after.board).toEqual(before.board);
      expect(after.readiedSpells).toEqual([]); expect(after.ongoingSpells).toEqual(before.ongoingSpells);
      expect(after.activeSpellOrder).toEqual([ongoing.id]);
      expect(after.players[0].prepared.slot1).toEqual({ card: dummy, used: true });
      expect(after.players.map(player => player.actionTokens)).toEqual(before.players.map(player => player.actionTokens));
      expect(after.activation).toMatchObject({ actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: true });
      expect(after.library.find(deck => deck.id === 'transmutation')!.discard).toContainEqual(dummy);
      expect(after.library.find(deck => deck.id === 'enchantment')!.discard).toContainEqual(trap.card);
      const facts = after.feedbackEvents!.slice(before.feedbackEvents!.length);
      expect(facts.map(event => event.kind)).toEqual(['SPELL_TRIGGERED', 'DAMAGE', 'SPELL_TRIGGERED', 'DAMAGE']);
      expect(facts.filter(event => event.kind === 'SPELL_TRIGGERED').map(event => [event.cardName, event.trigger, event.roomId, event.ongoing]))
        .toEqual([['Spell Leech', 'SPELL_CAST', center, false], ['Arcane Feedback', 'SPELL_CAST', center, true]]);
      expect(facts.filter(event => event.kind === 'DAMAGE').map(event => [event.sourceId, event.target.id, event.amount]))
        .toEqual([['p2', 'p1', 2], ['p3', 'p1', 1]]);
      expect(wire.history.status(after, 'p1')).toEqual({ canUndo: false, canRedo: false });
      await selectSpells(page); await expect(hidden).toHaveCount(0); await expect(undo(page)).toHaveCount(0); await expect(redo(page)).toHaveCount(0);
      await expect(page.locator('.player[data-player-id="p1"]').getByRole('meter')).toHaveAttribute('aria-valuenow', String(after.players[0].wizard.damageCubes));
      const dialog = await openChronicle(page);
      await expect(dialog.getByRole('log').locator(':scope > div').filter({ hasText: 'Interrupt SPELL_CAST: Blue Seer reveals Spell Leech.' })).toHaveCount(1);
      await expect(dialog.getByRole('log')).toContainText("Summoner's Balm on a dummy (no model effects)");
      await closeChronicle(page);
      expect(wire.requests).toHaveLength(1);
    });
  });
}