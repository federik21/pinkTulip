import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { applyAction, BLACK_ROSE_ID, createGame, getSpellType } from '../packages/game-engine/src/index';
import type { ActiveSpell, Card, Evocation, GameAction, GameState, Room, SpellType } from '../packages/game-engine/src/index';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { expectSpellIcon, expectSpellType } from './spell-ui';
import { openMageDetails, selectControlTab } from './layout-ui';

type Cast = Extract<GameAction, { type: 'CAST_SPELL' }>;
type Slot = Cast['slot'];
type Selection = Omit<Cast, 'type' | 'playerId' | 'slot'>;
type Reply = { action: GameAction; before: GameState; after: GameState };
const center = 'room-0,0', east = 'room-1,0';
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

function fixture(actor = 'p1'): GameState {
  const game = createGame(2);
  game.gameId = 'reactive-spells'; game.round = 1; game.phase = 'ACTION';
  game.firstPlayerId = 'p1'; game.currentPlayerId = actor;
  game.activation = { playerId: actor, actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
    spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
  game.players.forEach((p, i) => {
    p.name = ['Rose Warden', 'Blue Seer'][i]; p.connected = p.ready = true;
    p.wizard.position = { q: 0, r: 0 }; // No starting-room immunity in reactive scenarios.
  });
  game.board.rooms.forEach((r, i) => { r.name = r.id === center ? 'Rose Sanctum' : `Runic Chamber ${i + 1}`; });
  return game;
}
const mage = (game: GameState, id = 'p1') => game.players.find(p => p.id === id)!;
const room = (game: GameState, id = center) => game.board.rooms.find(r => r.id === id)!;
const school = (game: GameState) => game.library.find(d => d.id === 'enchantment')!;
function take(game: GameState, name: string): Card {
  for (const deck of game.library) {
    const index = deck.cards.findIndex(card => card.name === name);
    if (index >= 0) return deck.cards.splice(index, 1)[0];
  }
  throw new Error(`Missing canonical physical card: ${name}`);
}
function prepare(game: GameState, name: string, slot: Slot = 'slot1', owner = 'p1'): Card {
  const card = take(game, name);
  mage(game, owner).prepared[slot] = { card, used: false };
  return card;
}
function servant(id: string, playerId: string): Evocation {
  return { id, playerId, number: 1, name: 'Cadaver', archetype: 'UNDEAD', movement: 2, attack: 2,
    health: 2, passive: 'WOUNDED_FURY', position: { q: 0, r: 0 }, damageCubes: 0,
    damageByPlayer: {}, activated: false };
}
function syncCubes(game: GameState) {
  for (const p of game.players) {
    p.cubes.onWizard = game.players.reduce((n, target) => n + (target.wizard.damageByPlayer[p.id] ?? 0), 0);
    p.cubes.onEvocations = game.evocations.reduce((n, target) => n + (target.damageByPlayer[p.id] ?? 0), 0);
    p.cubes.onBoard = game.board.rooms.filter(r => !r.scored && !r.reconstructed)
      .reduce((n, r) => n + (r.cubesByPlayer[p.id] ?? 0), 0);
    p.cubes.available = 25 - p.cubes.onWizard - p.cubes.onEvocations - p.cubes.onBoard;
  }
}
function physicalCards(game: GameState) {
  return [...game.library.flatMap(d => [...d.cards, ...d.discard]), ...game.powerfulDeck, ...game.removedCards,
    ...[...game.readiedSpells ?? [], ...game.ongoingSpells ?? []].map(active => active.card),
    ...game.players.flatMap(p => [...p.hand, ...p.personalDeck, ...p.discard,
      ...Object.values(p.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])]
    .map(card => card.id).sort();
}
function conserved(game: GameState, cards: string[]) {
  expect(cards).toHaveLength(120);
  expect(new Set(cards).size).toBe(cards.length);
  expect(physicalCards(game)).toEqual(cards);
  const expected = structuredClone(game); syncCubes(expected);
  for (const [i, p] of game.players.entries()) {
    expect(p.cubes).toEqual(expected.players[i].cubes);
    expect(Object.values(p.cubes).every(n => Number.isInteger(n) && n >= 0)).toBe(true);
    expect(Object.values(p.cubes).reduce((n, value) => n + value, 0)).toBe(25);
  }
}
function expectPrivacy(game: GameState, history: ActionHistory) {
  const before = structuredClone(game);
  for (const viewer of ['p1', 'p2', null]) {
    const visible = JSON.parse(JSON.stringify(publicState(game, viewer, history))) as GameState;
    expect(visible.ongoingSpells).toEqual(game.ongoingSpells);
    expect(visible.activeSpellOrder).toEqual(game.activeSpellOrder);
    expect(visible.log).toEqual(game.log);
    expect(visible.readiedSpells).toEqual(game.readiedSpells?.map((active, i) => active.playerId === viewer
      ? active : { id: active.id, playerId: active.playerId, card: { id: `hidden-${i}`, name: 'Hidden spell',
        kind: 'SPELL', damage: 0, instability: 0, range: 0, target: 'MODEL' } }));
    for (const active of visible.readiedSpells ?? []) if (active.playerId !== viewer) {
      expect(Object.keys(active).sort()).toEqual(['card', 'id', 'playerId']);
      expect(JSON.stringify(active)).not.toMatch(/schoolId|spellType|rulesText|trigger|roomId|targetPlayerId|targetEvocationId/);
      const original = game.readiedSpells!.find(a => a.id === active.id)!;
      expect(JSON.stringify(visible)).not.toContain(`"${original.card.id}"`);
    }
  }
  expect(game).toEqual(before);
}

async function mount(page: Page, initial: GameState, options: { unmaskedReadied?: boolean } = {}) {
  let game = structuredClone(initial), visible: GameState | undefined;
  const history = new ActionHistory(), replies: Reply[] = [], cards = physicalCards(game);
  let publish: () => void = () => { throw new Error('Fixture socket is not connected'); };
  conserved(game, cards);
  // Both browser commands and simulated peer/root commands use this exact reducer.
  // Never reduce a public projection: it deliberately lacks future/hidden cards.
  const reduce = (action: GameAction): Reply => {
    const before = game, after = applyAction(before, action);
    conserved(after, cards); game = after;
    return { action, before, after };
  };
  await page.routeWebSocket('**', route => {
    publish = () => {
      visible = publicState(game, 'p1', history);
      // Deliberately bypass only the fixture's readied-zone projection in one
      // defense-in-depth case. ActiveSpellsPanel must still protect foreign cards.
      if (options.unmaskedReadied) visible.readiedSpells = structuredClone(game.readiedSpells);
      route.send(JSON.stringify({ type: 'STATE', state: visible }));
    };
    route.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: game.gameId }));
        publish();
      } else if (message.action) {
        try {
          expect(message.action.playerId).toBe('p1');
          replies.push(reduce(message.action)); publish();
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
  return { replies, history, get state() { return game; }, get visible() { return visible!; },
    dispatch(action: GameAction) { const reply = reduce(action); publish(); return reply; } };
}
type Wire = Awaited<ReturnType<typeof mount>>;
const hex = (page: Page, id = center) => page.locator(`.hex[data-room-id="${id}"]`);
const player = (page: Page, id: string) => page.locator(`.player[data-player-id="${id}"]`);
const activeZone = (page: Page) => page.getByRole('region', { name: 'Active and ongoing spells', exact: true });
const readied = (page: Page, active: ActiveSpell) => activeZone(page).locator(`article.readied-spell[data-active-spell-id="${active.id}"]`);
const ongoing = (page: Page, active: ActiveSpell) => activeZone(page).locator(`article.ongoing-spell[data-active-spell-id="${active.id}"]`);
const prepared = (page: Page, name: string, slot: Slot = 'slot1') => page.locator('.prepared .spell').filter({
  has: page.locator('strong', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
}).filter({ has: page.locator('.eyebrow', { hasText: slot === 'rapid' ? /\bFlexible\b/ : new RegExp(`^Spell ${slot.slice(-1)}\\b`) }) });
const targetSelect = (page: Page) => page.getByRole('combobox', { name: 'Spell target model', exact: true });
const confirm = (page: Page) => page.locator('.room-detail').getByRole('button', { name: /^(Activate|Cast) / });
const chronicle = (page: Page) => page.getByRole('log');
async function command(page: Page, wire: Wire, click: () => Promise<unknown>, expected: GameAction): Promise<Reply> {
  const index = wire.replies.length;
  await click(); await expect.poll(() => wire.replies.length).toBe(index + 1);
  const reply = wire.replies[index]; expect(reply.action).toEqual(expected);
  await expect(page.getByRole('alert')).toHaveCount(0);
  return reply;
}
async function noDummy(page: Page) {
  await expect(page.locator('.target-mode')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Target dummy · no damage', exact: true })).toHaveCount(0);
}
async function expectOptions(page: Page, ids: string[]) {
  await expect(targetSelect(page)).toBeVisible();
  await expect(targetSelect(page).locator('option')).toHaveCount(ids.length + 1);
  expect(await targetSelect(page).locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value)))
    .toEqual(['', ...ids]);
  await expect(targetSelect(page).locator('option').first()).toHaveText('First eligible model in this room');
}
async function expectChronicle(page: Page, game: GameState) {
  await expect(page.getByRole('heading', { name: 'Chronicle', exact: true })).toBeVisible();
  // Each entry has a decorative rune; assert the actual latest-first DOM order.
  await expect(chronicle(page).locator(':scope > div')).toHaveText(game.log.slice(-45).reverse().map(entry => `✧${entry}`));
}
async function screenshot(testInfo: TestInfo, name: string, locator: Locator) {
  await testInfo.attach(name, { body: await locator.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' }),
    contentType: 'image/png' });
}
async function beginExplore(page: Page, wire: Wire) {
  await selectControlTab(page, 'Actions');
  await command(page, wire, () => page.locator('.actions-panel').getByRole('button', { name: /^Explore/ }).click(),
    { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
  await command(page, wire, () => page.getByRole('button', { name: /^Perform 2 movements/ }).click(),
    { type: 'PERFORM_MOVEMENT', playerId: 'p1' });
  await expect(page.locator('.movement-progress strong')).toHaveText('2 movement remaining');
}
async function expectRoomContributions(page: Page, expected: Room) {
  const tile = hex(page, expected.id);
  await expect(tile.locator('.cube-count')).toHaveText(`◆ ${expected.instability}/${expected.instabilityLimit}`);
  const contributions = Object.entries(expected.cubesByPlayer).filter(([, n]) => n > 0);
  await expect(tile.locator('.capacity-fill[data-owner-id]')).toHaveCount(contributions.length);
  for (const [id, cubes] of contributions) {
    await expect(tile.locator(`.capacity-fill[data-owner-id="${id}"]`)).toHaveAttribute('data-cubes', String(cubes));
    await expect(page.locator('.room-detail .contributions')).toContainText(`${id === BLACK_ROSE_ID ? '(not) Black Rose' : id === 'p1' ? 'Rose Warden' : 'Blue Seer'}: ${cubes}`);
  }
}

const readiness: { name: string; label: string; target: Card['target']; selection: Selection; options?: string[]; binding?: string }[] = [
  { name: 'Threshold Snare', label: 'Trap', target: 'ROOM', selection: { roomId: east } },
  { name: 'Hearth Ward', label: 'Protection', target: 'ROOM', selection: { roomId: east } },
  { name: 'Thorn Retort', label: 'Protection', target: 'SELF', selection: { targetPlayerId: 'p1' }, binding: 'Rose Warden' },
  { name: 'Mending Ward', label: 'Protection', target: 'MAGE', selection: { targetPlayerId: 'p2' }, options: ['p1', 'p2'], binding: 'Blue Seer' },
  { name: "Servant's Safeguard", label: 'Protection', target: 'EVOCATION', selection: { targetEvocationId: 'own-one' }, options: ['own-one', 'enemy-one'], binding: 'Rose Warden · Cadaver #1' },
];

for (const viewport of [{ width: 1440, height: 1200 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px reactive spells`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });

    test('Enchantment is a separate named 12-pattern school with its own draw and discard supply', async ({ page }, testInfo) => {
      const game = fixture(); game.phase = 'STUDY'; game.currentPlayerId = null; game.activation = null;
      // Study-only fixture: move real Cantrip copies, never invent a base deck.
      for (const p of game.players) p.hand.push(...game.library.find(d => d.id === 'cantrip')!.cards.splice(0, 2));
      const deck = school(game);
      expect(deck.cards).toHaveLength(36);
      const names = new Set(deck.cards.map(card => card.name)); expect(names.size).toBe(12);
      for (const name of names) expect(deck.cards.filter(card => card.name === name)).toHaveLength(3);
      const drawn = ['Threshold Snare', 'Thorn Retort', "Pilgrim's Mark", 'Thorned Path'].map(name => take(game, name));
      deck.cards.unshift(...drawn); // Deterministic draw of real, unique physical copies.
      const others = structuredClone(game.library.filter(d => d.id !== 'enchantment'));
      const wire = await mount(page, game), panel = page.locator('.phase-panel');
      const tile = panel.locator('.schools button[data-school-id="enchantment"]');
      await expect(panel.locator('.schools button')).toHaveCount(3);
      for (const [id, name] of [['cantrip', 'Cantrip'], ['transmutation', 'Transmutation'], ['enchantment', 'Enchantment']]) {
        await expect(panel.locator(`.schools button[data-school-id="${id}"] strong`)).toHaveText(name);
      }
      await expect(tile).toBeEnabled(); await expect(tile).toContainText('36 draw · 0 discard');
      await expect(tile).toContainText('Hidden traps · Protections · Ongoing effects');
      await screenshot(testInfo, `enchantment-school-${viewport.width}`, panel);
      await command(page, wire, () => tile.click(), { type: 'DRAW_STUDY', playerId: 'p1', deckId: 'enchantment' });
      expect(mage(wire.state).hand.filter(card => card.schoolId === 'enchantment')).toEqual(drawn);
      expect(school(wire.state).cards).toHaveLength(32);
      expect(wire.state.library.filter(d => d.id !== 'enchantment')).toEqual(others);
      await expect(panel.locator('.spell')).toHaveCount(6);
      for (const card of drawn.slice(0, 2)) await panel.locator('.spell').filter({ has: page.getByText(card.name, { exact: true }) }).click();
      await command(page, wire, () => panel.getByRole('button', { name: 'Discard selected (2/2)', exact: true }).click(),
        { type: 'DISCARD_STUDY', playerId: 'p1', cardIds: drawn.slice(0, 2).map(card => card.id) });
      expect(school(wire.state).discard).toEqual(drawn.slice(0, 2));
      expect(mage(wire.state).discard).toEqual([]);
      expect(wire.state.library.filter(d => d.id !== 'enchantment')).toEqual(others);
      await expect(page.getByText('✓ Study complete. Waiting for the other mages.', { exact: true })).toBeVisible();
    });

    test('prepared canonical school cards distinguish all four spell types, targets and printed rules', async ({ page }, testInfo) => {
      const game = fixture();
      const cases: { name: string; slot: Slot; type: SpellType; label: string; target: string }[] = [
        { name: 'Threshold Snare', slot: 'slot1', type: 'TRAP', label: 'Trap', target: 'Room' },
        { name: 'Thorn Retort', slot: 'slot2', type: 'PROTECTION', label: 'Protection', target: 'Self' },
        { name: 'Thorned Path', slot: 'slot3', type: 'COMBAT', label: 'Combat · Ongoing', target: 'Mage' },
        { name: "Pilgrim's Mark", slot: 'rapid', type: 'CONTINGENCY', label: 'Contingency · Ongoing', target: 'Self' },
      ];
      for (const item of cases) prepare(game, item.name, item.slot);
      await mount(page, game);
      await expect(page.locator('.prepared .spell')).toHaveCount(4);
      for (const item of cases) {
        const card = mage(game).prepared[item.slot]!.card, button = prepared(page, item.name, item.slot);
        expect(card.schoolId).toBe('enchantment'); expect(getSpellType(card)).toBe(item.type);
        await expect(button.locator('strong')).toHaveText(item.name);
        await expect(button.locator('.eyebrow')).toHaveText(`${item.slot === 'rapid' ? '✧ Flexible' : `Spell ${item.slot.slice(-1)}`} · ${item.target}`);
        await expect(button.locator('.spell-type')).toHaveAttribute('data-spell-type', item.type);
        await expectSpellType(button.locator('.spell-type'), item.label);
        const typeName = item.label.split(' · ')[0];
        await expectSpellIcon(button, typeName);
        await expect(button.locator('.spell-rules')).toHaveText(card.rulesText!);
        if (item.type === 'TRAP' || item.type === 'PROTECTION') {
          expect(card.rulesText).toMatch(/^Activate secretly/);
          await expect(button.locator('.spell-rules')).not.toContainText('Ready secretly');
        }
      }
      await prepared(page, "Pilgrim's Mark", 'rapid').click(); await noDummy(page);
      await expect(confirm(page)).toHaveText("Cast Pilgrim's Mark on yourself");
      await screenshot(testInfo, `enchantment-school-cards-${viewport.width}`, page.locator('.cards.prepared'));
    });

    for (const scenario of readiness) {
      test(`Activate ${scenario.label} ${scenario.name} uses a real ${scenario.target} binding and one action, not a token`, async ({ page }) => {
        const game = fixture(), card = prepare(game, scenario.name);
        prepare(game, 'Runic Remedy', 'slot2'); prepare(game, "Pilgrim's Mark", 'rapid');
        game.evocations = [servant('own-one', 'p1'), servant('enemy-one', 'p2')];
        const wire = await mount(page, game), button = prepared(page, scenario.name);
        await button.click(); await noDummy(page);
        await expectSpellType(button.locator('.spell-type'), scenario.label);
        if (scenario.target === 'SELF') {
          await expect(hex(page)).toHaveClass(/selected/);
          await expect(confirm(page)).toHaveText(`Activate ${scenario.name} on yourself`);
          await hex(page, east).click(); await expect(confirm(page)).toBeDisabled();
          await button.click(); await button.click(); // Reopening SELF must reset a stale room selection.
          await expect(hex(page)).toHaveClass(/selected/);
          await expect(targetSelect(page)).toHaveCount(0);
        } else {
          await expect(confirm(page)).toHaveCount(0);
          await hex(page, 'room-1,1').click();
          await expect(hex(page, 'room-1,1')).not.toHaveClass(/reachable/);
          await expect(confirm(page)).toBeDisabled();
          await hex(page, mage(game).wizard.startingRoomId).click();
          await expect(confirm(page)).toBeDisabled();
          await hex(page, scenario.selection.roomId ?? center).click();
          if (scenario.options) {
            await expectOptions(page, scenario.options); await expect(targetSelect(page)).toHaveValue('');
            await targetSelect(page).selectOption(scenario.selection.targetPlayerId ?? scenario.selection.targetEvocationId!);
          } else await expect(targetSelect(page)).toHaveCount(0);
          await expect(confirm(page)).toHaveText(`Activate ${scenario.name} here`);
        }
        await noDummy(page); await expect(confirm(page)).toBeEnabled();
        expect(wire.replies).toHaveLength(0);
        const before = wire.state;
        await command(page, wire, () => confirm(page).click(), { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', ...scenario.selection });
        const after = wire.state, active = after.readiedSpells![0];
        expect(after.readiedSpells).toHaveLength(1); expect(after.ongoingSpells).toEqual([]);
        expect(active).toMatchObject({ playerId: 'p1', card, ...scenario.selection });
        expect(active.id).toMatch(/^[0-9a-f-]{36}$/); expect(active.id).not.toBe(card.id);
        expect(after.activeSpellOrder).toEqual([active.id]);
        expect(after.activation).toMatchObject({ playerId: 'p1', actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: true });
        expect(mage(after).actionTokens).toBe(mage(before).actionTokens);
        expect(mage(after).prepared.slot1).toEqual({ card, used: true });
        expect(after.board).toEqual(before.board);
        expect(after.players.map(p => p.wizard)).toEqual(before.players.map(p => p.wizard));
        expect(after.library).toEqual(before.library); expect(mage(after).discard).toEqual([]);
        await expect(button).toHaveClass(/used/); await expect(button).toBeDisabled();
        await expect(prepared(page, 'Runic Remedy', 'slot2')).toBeDisabled();
        await expect(prepared(page, "Pilgrim's Mark", 'rapid')).toBeEnabled();
        await expect(page.locator('.phase-panel .badge')).toHaveText('1 turn actions left');
        await selectControlTab(page, 'More');
        const own = readied(page, active);
        await expect(own).toHaveClass(/own-spell/);
        await expect(own.locator('strong')).toHaveText(card.name);
        await expectSpellType(own.locator('.spell-type'), `${scenario.label} · Active`);
        await expect(activeZone(page).getByRole('heading', { name: 'Active & ongoing', exact: true })).toBeVisible();
        await expect(own.getByRole('img', { name: `${scenario.label} spell`, exact: true })).toBeVisible();
        await expect(own.locator('p')).toHaveText(card.rulesText!);
        await expect(own.locator('small'), 'Owned readiness shows its actual room or model binding')
          .toHaveText(`Rose Warden · ${scenario.binding ?? room(after, active.roomId).name}`);
        expect(after.log.at(-1)).toBe('Rose Warden activates a hidden spell for 1 action (no physical token).');
        expect(after.log.join('\n')).not.toContain(card.name);
        await expect(chronicle(page)).not.toContainText(card.name);
        expectPrivacy(after, wire.history); await expectChronicle(page, after);
      });
    }

    test('foreign full-card fixtures still hide readied names, rules and bindings while own cards remain readable', async ({ page }, testInfo) => {
      let game = fixture();
      prepare(game, 'Threshold Snare'); prepare(game, "Pilgrim's Mark", 'rapid');
      prepare(game, 'Mending Ward', 'slot1', 'p2');
      game = applyAction(game, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: east });
      game = applyAction(game, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p1' });
      game = applyAction(game, { type: 'CAST_SPELL', playerId: 'p2', slot: 'slot1', targetPlayerId: 'p2' });
      game = applyAction(game, { type: 'END_ACTIVATION', playerId: 'p2' });
      const wire = await mount(page, game, { unmaskedReadied: true });
      expectPrivacy(wire.state, wire.history);
      const own = game.readiedSpells!.find(active => active.playerId === 'p1')!;
      const foreign = game.readiedSpells!.find(active => active.playerId === 'p2')!;
      // A passing assertion here cannot be explained by server masking alone.
      expect(wire.visible.readiedSpells!.find(active => active.id === foreign.id)).toEqual(foreign);
      await selectControlTab(page, 'More');
      const hidden = readied(page, foreign), known = readied(page, own);
      await expect(hidden).toHaveClass(/hidden-spell/);
      await expect(hidden.locator('strong')).toHaveText('Hidden active spell');
      await expect(hidden.locator('.spell-type')).toHaveText('Face down · Active');
      await expect(hidden.getByRole('img')).toHaveCount(0);
      await expect(hidden.locator('small')).toHaveText('Blue Seer');
      await expect(hidden.locator('p')).toHaveText('Its card, binding and trigger are hidden until it reveals.');
      const markup = await hidden.evaluate(el => el.outerHTML);
      for (const secret of [foreign.card.name, foreign.card.rulesText!, foreign.card.id, room(game, foreign.roomId).name]) expect(markup).not.toContain(secret);
      await expect(page.locator('.app')).not.toContainText(foreign.card.name);
      await expect(known).toHaveClass(/own-spell/);
      await expect(known.locator('strong')).toHaveText(own.card.name);
      await expect(known.locator('p')).toHaveText(own.card.rulesText!);
      await expect(known.locator('small')).toHaveText(`Rose Warden · ${room(game, east).name}`);
      await expect(activeZone(page).locator('.ongoing-spell strong')).toHaveText("Pilgrim's Mark");
      await screenshot(testInfo, `reactive-active-zone-${viewport.width}`, activeZone(page));
      expect(wire.replies).toHaveLength(0);
    });

    test('enemy entry automatically reveals a projected trap, interrupts Chronicle and resumes the second Explore step', async ({ page }) => {
      let game = fixture('p2'); const card = prepare(game, 'Threshold Snare', 'slot1', 'p2');
      game = applyAction(game, { type: 'CAST_SPELL', playerId: 'p2', slot: 'slot1', roomId: east });
      game = applyAction(game, { type: 'END_ACTIVATION', playerId: 'p2' });
      const wire = await mount(page, game), active = game.readiedSpells![0];
      expectPrivacy(wire.state, wire.history);
      await selectControlTab(page, 'More');
      await expect(readied(page, active).locator('strong')).toHaveText('Hidden active spell');
      await expect(page.locator('.app')).not.toContainText(card.name);
      await beginExplore(page, wire);
      expect(wire.state.readiedSpells).toHaveLength(1); // Beginning movement is not entry.
      await command(page, wire, () => hex(page, east).click(),
        { type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 1, r: 0 } });
      expect(wire.state.readiedSpells).toEqual([]); expect(wire.state.activeSpellOrder).toEqual([]);
      expect(school(wire.state).discard).toEqual([card]);
      expect(mage(wire.state).wizard).toMatchObject({ position: { q: 1, r: 0 }, damageCubes: 2, damageByPlayer: { p2: 2 } });
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, spellsCast: 0, exploring: 1,
        physicalAction: { kind: 'EXPLORE', movementStarted: true, mainEffectUsed: false } });
      expect(mage(wire.state).actionTokens).toBe(1);
      await selectControlTab(page, 'More');
      await expect(activeZone(page)).toHaveCount(0);
      await expect(player(page, 'p1').getByRole('meter')).toHaveAttribute('aria-valuenow', '2');
      await selectControlTab(page, 'Actions');
      await expect(page.locator('.movement-progress strong')).toHaveText('1 movement remaining');
      expect(wire.state.log.slice(-4)).toEqual([
        'Interrupt ENTER_ROOM: Blue Seer reveals Threshold Snare.',
        'Blue Seer places 2 damage cubes on Rose Warden.',
        'Rose Warden suffers 2 damage.',
        'Resume ENTER_ROOM after Threshold Snare.',
      ]);
      await expectChronicle(page, wire.state);
      await expect(chronicle(page).locator(':scope > div').filter({ hasText: 'reveals Threshold Snare' })).toHaveCount(1);
      for (const viewer of ['p1', 'p2', null]) expect(school(publicState(wire.state, viewer, wire.history)).discard).toEqual([card]);
      await command(page, wire, () => hex(page).click(),
        { type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 0, r: 0 } });
      await command(page, wire, () => page.getByRole('button', { name: 'Skip remaining effects', exact: true }).click(),
        { type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
      // Re-entering the same room must not fire a spent physical copy again.
      await beginExplore(page, wire);
      await command(page, wire, () => hex(page, east).click(),
        { type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 1, r: 0 } });
      expect(mage(wire.state).wizard.damageCubes).toBe(2);
      expect(wire.state.log.filter(entry => entry.startsWith('Interrupt '))).toHaveLength(1);
      expect(school(wire.state).discard).toEqual([card]);
      expect(wire.replies.filter(reply => reply.action.type === 'CAST_SPELL')).toEqual([]);
    });

    test('nested Protections reveal and finish depth-first before the physical attack resumes', async ({ page }) => {
      let game = fixture(); const ownCard = prepare(game, 'Thorn Retort'), enemyCard = prepare(game, 'Thorn Retort', 'slot1', 'p2');
      game = applyAction(game, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p1' });
      game = applyAction(game, { type: 'END_ACTIVATION', playerId: 'p1' });
      game = applyAction(game, { type: 'CAST_SPELL', playerId: 'p2', slot: 'slot1', targetPlayerId: 'p2' });
      game = applyAction(game, { type: 'END_ACTIVATION', playerId: 'p2' });
      const wire = await mount(page, game); expectPrivacy(wire.state, wire.history);
      await selectControlTab(page, 'More');
      await expect(activeZone(page).locator('.own-spell strong')).toHaveText('Thorn Retort');
      await expect(activeZone(page).locator('.hidden-spell strong')).toHaveText('Hidden active spell');
      await selectControlTab(page, 'Actions');
      await command(page, wire, () => page.locator('.actions-panel').getByRole('button', { name: /^Attack/ }).click(),
        { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' });
      await page.getByRole('button', { name: /^Inflict 2 damage to a model/ }).click();
      await command(page, wire, () => page.getByRole('group', { name: 'Attack target', exact: true })
        .getByRole('button', { name: 'Inflict 2 damage on Blue Seer', exact: true }).click(),
        { type: 'INFLICT_ATTACK', playerId: 'p1', targetId: 'p2' });
      expect(wire.state.log.filter(entry => /^(Interrupt|Resume) /.test(entry))).toEqual([
        'Interrupt DAMAGE_TAKEN: Blue Seer reveals Thorn Retort.',
        'Interrupt DAMAGE_TAKEN: Rose Warden reveals Thorn Retort.',
        'Resume DAMAGE_TAKEN after Thorn Retort.', 'Resume DAMAGE_TAKEN after Thorn Retort.',
      ]);
      expect(wire.state.players.map(p => p.wizard.damageCubes)).toEqual([0, 2]);
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, spellsCast: 0,
        physicalAction: { kind: 'ATTACK', mainEffectUsed: true } });
      expect(mage(wire.state).actionTokens).toBe(1);
      expect(wire.state.readiedSpells).toEqual([]); expect(wire.state.activeSpellOrder).toEqual([]);
      expect(school(wire.state).discard).toEqual([enemyCard, ownCard]);
      await selectControlTab(page, 'More');
      await expect(activeZone(page)).toHaveCount(0);
      await expect(player(page, 'p1').getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
      await expect(player(page, 'p2').getByRole('meter')).toHaveAttribute('aria-valuenow', '2');
      await expectChronicle(page, wire.state);
      expect(wire.replies.map(reply => reply.action.type)).toEqual(['BEGIN_PHYSICAL_ACTION', 'INFLICT_ATTACK']);
      await selectControlTab(page, 'Actions');
      await command(page, wire, () => page.getByRole('button', { name: 'Skip remaining effects', exact: true }).click(),
        { type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, physicalAction: null });
    });

    test('SELF Pilgrim’s Mark follows movement, converts room contributions and expires on bound-mage defeat, not respawn', async ({ page }, testInfo) => {
      const game = fixture(), card = prepare(game, "Pilgrim's Mark");
      Object.assign(room(game, east), { instability: 3, cubesByPlayer: { p2: 2, [BLACK_ROSE_ID]: 1 } });
      Object.assign(room(game), { instability: 2, cubesByPlayer: { p2: 1, [BLACK_ROSE_ID]: 1 } });
      const exit = room(game, 'room-2,-2');
      Object.assign(exit, { instability: 1, cubesByPlayer: { p2: 1 } });
      Object.assign(mage(game).wizard, { damageCubes: 8, damageByPlayer: { p2: 8 } }); syncCubes(game);
      const wire = await mount(page, game), button = prepared(page, card.name);
      await button.click(); await noDummy(page);
      await expect(hex(page)).toHaveClass(/selected/);
      await expect(confirm(page)).toHaveText("Cast Pilgrim's Mark on yourself");
      await expect(targetSelect(page)).toHaveCount(0);
      await command(page, wire, () => confirm(page).click(),
        { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p1' });
      const active = wire.state.ongoingSpells![0];
      expect(active).toMatchObject({ card, playerId: 'p1', targetPlayerId: 'p1' });
      expect(wire.state.readiedSpells).toEqual([]); expect(school(wire.state).discard).toEqual([]);
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, spellsCast: 1 });
      expect(mage(wire.state).actionTokens).toBe(2);
      await selectControlTab(page, 'More');
      const effect = ongoing(page, active);
      await expect(effect.locator('strong')).toHaveText(card.name);
      await expectSpellType(effect.locator('.spell-type'), 'Contingency · Ongoing');
      await expect(effect.locator('p')).toHaveText(card.rulesText!);
      expectPrivacy(wire.state, wire.history);
      await screenshot(testInfo, `pilgrims-mark-ongoing-${viewport.width}`, activeZone(page));
      // A SELF ongoing effect is bound to the mage, not its original chamber.
      await expect(effect.locator('small'), 'Ongoing SELF binding identifies the mage')
        .toHaveText('Rose Warden · Bound to Rose Warden');
      await beginExplore(page, wire);
      await command(page, wire, () => hex(page, east).click(),
        { type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 1, r: 0 } });
      expect(room(wire.state, east)).toMatchObject({ instability: 3, cubesByPlayer: { p1: 1, p2: 1, [BLACK_ROSE_ID]: 1 } });
      // Inspecting the already occupied hex selects details without taking a step.
      await hex(page, east).click(); await expectRoomContributions(page, room(wire.state, east));
      await openMageDetails(page, 'p1'); await openMageDetails(page, 'p2');
      await expect(player(page, 'p1').locator('.cube-pool')).toContainText('In rooms: 1');
      await expect(player(page, 'p2').locator('.cube-pool')).toContainText('In rooms: 3');
      await selectControlTab(page, 'More');
      await expect(effect.locator('small'), 'Ongoing binding follows the mage after movement')
        .toHaveText('Rose Warden · Bound to Rose Warden');
      expect(wire.state.ongoingSpells).toEqual([active]);
      await selectControlTab(page, 'Actions');
      await expect(page.locator('.movement-progress strong')).toHaveText('1 movement remaining');
      await command(page, wire, () => hex(page).click(),
        { type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 0, r: 0 } });
      expect(room(wire.state)).toMatchObject({ instability: 2, cubesByPlayer: { p1: 1, [BLACK_ROSE_ID]: 1 } });
      await hex(page).click(); await expectRoomContributions(page, room(wire.state));
      await expect(player(page, 'p1').locator('.cube-pool')).toContainText('In rooms: 2');
      await expect(player(page, 'p2').locator('.cube-pool')).toContainText('In rooms: 2');
      expect(wire.state.activation).toMatchObject({ actionsUsed: 2, spellsCast: 1, exploring: 0 });
      expect(wire.state.currentPlayerId).toBe('p1'); // Pending physical effects delay handoff.
      expect(wire.state.log.filter(entry => entry === "Interrupt ENTER_ROOM: Rose Warden reacts with Pilgrim's Mark.")).toHaveLength(2);
      await expectChronicle(page, wire.state);
      await command(page, wire, () => page.getByRole('button', { name: 'Skip remaining effects', exact: true }).click(),
        { type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
      expect(wire.state.currentPlayerId).toBe('p2');
      // Simulate only the peer's root command; defeat/expiry/reveal are engine results.
      wire.dispatch({ type: 'PUNCH', playerId: 'p2', targetId: 'p1' });
      expect(wire.state.ongoingSpells).toEqual([]); expect(wire.state.activeSpellOrder).toEqual([]);
      expect(school(wire.state).discard).toEqual([card]); expect(mage(wire.state, 'p2').kills).toBe(1);
      expect(mage(wire.state).wizard.position).toEqual(room(wire.state, mage(wire.state).wizard.startingRoomId).tiles[0]);
      expect(mage(wire.state).wizard.damageCubes).toBe(0);
      await selectControlTab(page, 'More');
      await expect(activeZone(page)).toHaveCount(0);
      await expect(player(page, 'p1').getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
      await expect(chronicle(page).locator(':scope > div').filter({ hasText: "Pilgrim's Mark expires with its bound model." })).toHaveCount(1);
      expectPrivacy(wire.state, wire.history);
      wire.dispatch({ type: 'END_ACTIVATION', playerId: 'p2' });
      expect(wire.state.currentPlayerId).toBe('p1');
      await beginExplore(page, wire);
      await command(page, wire, () => hex(page, exit.id).click(),
        { type: 'EXPLORE_STEP', playerId: 'p1', destination: exit.tiles[0] });
      expect(room(wire.state, exit.id).cubesByPlayer).toEqual({ p2: 1 });
      expect(school(wire.state).discard).toEqual([card]); expect(wire.state.ongoingSpells).toEqual([]);
      expect(wire.state.log.filter(entry => entry.includes('reacts with Pilgrim\'s Mark'))).toHaveLength(2);
      await selectControlTab(page, 'More');
      await expect(activeZone(page)).toHaveCount(0);
    });
  });
}
