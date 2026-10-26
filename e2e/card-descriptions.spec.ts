import { expect, test, type Locator, type Page } from '@playwright/test';
import { applyAction, createGame } from '../packages/game-engine/src';
import { createEnchantmentFixtures } from '../packages/game-engine/test/enchantment-fixtures';
import type { Card, GameAction, GameState, PreparedCards } from '../packages/game-engine/src';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { closeControls, pressHistory, selectSpells } from './layout-ui';
import { expectSpellType } from './spell-ui';

type Description = { name: string; type: 'TRAP' | 'PROTECTION'; trigger: string; body: string; chips: string[] };
const slots: (keyof PreparedCards)[] = ['slot1', 'slot2', 'slot3', 'rapid'];

// Independent copy/target expectations, not getSpellDescription() or the client
// component under test. Include every reactive constructor in both catalogs.
const descriptions: Description[] = [
  { name: 'Torment', type: 'TRAP', trigger: 'When an enemy model deals damage',
    body: 'you may reveal this trap at the end of the current moment. Inflict 2 damage on that model, then summon a Succubus in its room. The target is fixed by the trigger.',
    chips: ['⚔ Inflict 2', '✧ Summon SUCCUBUS'] },
  { name: 'Master of Pleasure', type: 'TRAP', trigger: 'When another mage solves a quest',
    body: 'you may reveal and inflict 2 damage on that mage, then summon a Succubus in their room. The target is fixed by the trigger.',
    chips: ['⚔ Inflict 2', '✧ Summon SUCCUBUS'] },
  { name: 'Liquefy the Pain', type: 'TRAP', trigger: 'When you are defeated',
    body: 'you may reveal and summon a Succubus in the room where they were defeated, during the defeat trigger window before scoring or returning to their cell. Then activate that Succubus for free: move and attack in either order, or finish early, even during another mage’s turn. Resume the interrupted turn or evocation afterward. The room is fixed by the trigger.',
    chips: ['✧ Summon SUCCUBUS', '↝ Activate Succubus · move / attack in either order'] },
  { name: 'Threshold Snare', type: 'TRAP', trigger: 'When an enemy enters a room within range 2',
    body: 'reveal and deal 2 damage to that model.', chips: ['⚔ Inflict 2'] },
  { name: 'Spell Leech', type: 'TRAP', trigger: 'When an enemy casts in a room within range 2',
    body: 'reveal and deal 2 damage to that caster before its printed effects resolve.', chips: ['⚔ Inflict 2'] },
  { name: 'Thorn Retort', type: 'PROTECTION', trigger: 'When damage is dealt to you',
    body: 'reveal and heal 1 wound before dealing 1 damage back to the attacker.', chips: ['♥ 1 heal', '⚔ Inflict 1'] },
  { name: 'Mending Ward', type: 'PROTECTION', trigger: 'When a mage within range 2 takes damage',
    body: 'reveal and heal that mage 2 wounds. Defeated models cannot be healed.', chips: ['♥ 2 heal'] },
  { name: "Servant's Safeguard", type: 'PROTECTION', trigger: 'When an evocation within range 3 takes damage',
    body: 'reveal and heal it 2 wounds. Destroyed models cannot be healed.', chips: ['♥ 2 heal'] },
  { name: 'Hearth Ward', type: 'PROTECTION', trigger: 'When an enemy activates a room within range 2',
    body: 'reveal and heal your mage 2 wounds before the room reward.', chips: ['♥ 2 heal'] },
  { name: 'Tripwire', type: 'TRAP', trigger: 'When an enemy evocation activates in a room within range 2 or in a room of the same color',
    body: 'reveal and deal 1 damage to it.', chips: ['⚔ Inflict 1'] },
  { name: 'Cinder Seal', type: 'TRAP', trigger: 'When an enemy activates a room within range 2 or in the same color',
    body: 'reveal and place 2 instability in that activated room before its reward.', chips: ['◆ 2 instability'] },
];
const description = (name: string) => descriptions.find(row => row.name === name)!;

function fixture(): GameState {
  const game = createGame(2);
  // Enchantment is not in the current live library. Add its complete finite
  // constructor supply, then move actual stock; never conjure individual cards.
  game.library.push({ id: 'enchantment', name: 'Enchantment', cards: createEnchantmentFixtures(), discard: [] });
  Object.assign(game, { gameId: 'card-descriptions', round: 1, phase: 'ACTION', currentPlayerId: 'p1', firstPlayerId: 'p1' });
  game.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
    spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
  for (const [index, player] of game.players.entries()) {
    player.connected = true;
    player.name = ['Description Warden', 'Description Seer'][index];
    player.wizard.position = { q: 0, r: 0 };
  }
  return game;
}

function take(game: GameState, name: string): Card {
  for (const pool of [...game.library.map(deck => deck.cards), game.powerfulDeck]) {
    const index = pool.findIndex(card => card.name === name);
    if (index >= 0) return pool.splice(index, 1)[0];
  }
  throw new Error(`Missing canonical physical card: ${name}`);
}

function physicalCards(game: GameState): Card[] {
  // Used preparations are references to cards now in an Active/discard/removed
  // zone. Quest reward templates are not physical library cards.
  return [...game.library.flatMap(deck => [...deck.cards, ...deck.discard]), ...game.powerfulDeck, ...game.removedCards,
    ...game.players.flatMap(player => [...player.hand, ...player.personalDeck, ...player.discard,
      ...Object.values(player.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])]),
    ...(game.readiedSpells ?? []).map(active => active.card), ...(game.ongoingSpells ?? []).map(active => active.card)];
}

function conserved(game: GameState, ids?: string[]) {
  const cards = physicalCards(game), actual = cards.map(card => card.id).sort();
  expect(cards).toHaveLength(84); // Agony 36 + explicitly supplied Enchantment 36 + Forgotten 12.
  expect(new Set(actual).size).toBe(84);
  expect(cards.filter(card => card.schoolId === 'agony')).toHaveLength(36);
  expect(cards.filter(card => card.schoolId === 'enchantment')).toHaveLength(36);
  expect(cards.filter(card => card.powerful)).toHaveLength(12);
  if (ids) expect(actual).toEqual(ids);
}

async function dismissPhase(page: Page) {
  const overlay = page.locator('.phase-overlay');
  await expect(overlay).toBeVisible();
  await overlay.click();
  await expect(overlay).toBeHidden();
}

async function mount(page: Page, initial: GameState) {
  conserved(initial);
  const ids = physicalCards(initial).map(card => card.id).sort();
  let game = structuredClone(initial), publish = (_state?: GameState) => {};
  const history = new ActionHistory(), actions: GameAction[] = [], errors: string[] = [];
  await page.routeWebSocket('**', route => {
    publish = (state = publicState(game, 'p1', history)) => {
      conserved(game, ids);
      route.send(JSON.stringify({ type: 'STATE', state }));
    };
    route.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: game.gameId }));
        publish();
      } else if (message.action) {
        try {
          // ActionHistory delegates real commands to applyAction and applies
          // the same authenticated ownership/history barriers as the server.
          game = history.apply(game, message.action, 'p1');
          actions.push(message.action);
          publish();
          route.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: message.requestId }));
        } catch (error) {
          errors.push(String(error));
          route.send(JSON.stringify({ type: 'ERROR', requestId: message.requestId, message: String(error) }));
        }
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await dismissPhase(page);
  await expect(page.locator('.app')).toBeVisible();
  return {
    actions, errors,
    get state() { return game; },
    get projection() { return publicState(game, 'p1', history); },
    update(next: GameState) { history.clear(); game = structuredClone(next); publish(); },
    dispatch(action: GameAction) { game = history.apply(game, action, action.playerId); publish(); },
    exposeForeignDetails() {
      // Defense in depth: deliberately violate the normal projection only on
      // this transmission. The owner-first renderer must still hide its copy.
      const state = publicState(game, 'p1', history);
      state.readiedSpells = structuredClone(game.readiedSpells);
      state.players[1].name += ' · projection probe';
      publish(state);
    },
  };
}

function spell(page: Page, scope: Locator, name: string) {
  return scope.locator('.spell').filter({ has: page.getByText(name, { exact: true }) });
}

async function noReady(scope: Locator) {
  await expect(scope.locator('[data-spell-status="READY"]')).toHaveCount(0);
  await expect(scope).not.toContainText(/\bReady\b/i);
}

async function expectDescription(container: Locator, row: Description, chips: boolean) {
  const trigger = container.locator('span.spell-trigger'), rules = container.locator('span.spell-rules');
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText(row.trigger);
  await expect(rules).toHaveCount(1);
  await expect(rules).toHaveText(row.body);
  await expect(rules).not.toHaveText(/^\s*(?:When|Whenever)\b/i);
  if (chips) {
    await expect(container.locator('.spell-effects')).toHaveCount(1);
    await expect(container.locator('.spell-effects > span')).toHaveText(row.chips);
    await expect(container.locator('span.spell-trigger + .spell-effects + span.spell-rules')).toHaveCount(1);
  } else {
    await expect(container.locator('.spell-effects')).toHaveCount(0);
    await expect(container.locator('span.spell-trigger + span.spell-rules')).toHaveCount(1);
  }
  // DOM order alone misses CSS flex/grid reordering or overlapping paragraphs.
  await trigger.scrollIntoViewIfNeeded();
  const layout = await container.evaluate(element => {
    const nodes = Array.from(element.querySelectorAll('.spell-trigger, .spell-effects, .spell-rules'));
    return nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
  });
  expect(layout).toHaveLength(chips ? 3 : 2);
  for (const box of layout) { expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0); }
  for (let index = 1; index < layout.length; index++) {
    expect(layout[index - 1].top).toBeLessThan(layout[index].top);
    expect(layout[index - 1].bottom).toBeLessThanOrEqual(layout[index].top + 1);
  }
  expect((await container.textContent())!.split(row.trigger)).toHaveLength(2);
  await noReady(container);
}

type PresentationPhase = 'STUDY' | 'PREPARATION' | 'ACTION';
function presentation(base: GameState, phase: PresentationPhase, names: string[], controls = false): GameState {
  let game = structuredClone(base);
  game.phase = phase;
  const player = game.players[0], cards = names.map(name => take(game, name));
  if (phase === 'ACTION') {
    player.preparationDone = true;
    cards.forEach((card, index) => { player.prepared[slots[index]] = { card, used: false }; });
    if (controls) {
      // A genuinely cast preparation retains Spent, but not the removed Ready
      // label. Its physical card has already moved to its proper discard.
      player.prepared.rapid = { card: take(game, 'Visceral Fire'), used: false };
      player.hand.push(take(game, 'Sovereign Wrath'));
      game = applyAction(game, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p2' });
    }
  } else {
    game.currentPlayerId = null;
    game.activation = null;
    player.hand = cards;
    player.studyDrawn = true;
    player.studyCardIds = cards.filter(card => !card.powerful).map(card => card.id);
  }
  return game;
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`card descriptions at ${viewport.width}px`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });
    let browserErrors: string[];
    test.beforeEach(async ({ page }) => {
      browserErrors = [];
      page.on('pageerror', error => browserErrors.push(error.message));
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    });
    test.afterEach(() => expect(browserErrors, 'Card/entry/dialog rendering must not throw').toEqual([]));

    for (const phase of ['STUDY', 'PREPARATION', 'ACTION'] as const) {
      test(`${phase}: all eleven canonical reactive definitions put one trigger above actual effect chips and rules, never Ready`, async ({ page }) => {
        const base = fixture(), ids = physicalCards(base).map(card => card.id).sort();
        const canonical = base.library.flatMap(deck => deck.cards).filter(card => card.spellType === 'TRAP' || card.spellType === 'PROTECTION');
        expect(new Set(canonical.map(card => card.name))).toEqual(new Set(descriptions.map(row => row.name)));
        expect(new Set(canonical.filter(card => card.schoolId === 'agony').map(card => card.name)).size).toBe(3);
        expect(new Set(canonical.filter(card => card.schoolId === 'enchantment').map(card => card.name)).size).toBe(8);
        for (const card of canonical) {
          expect(card.triggerText).toBe(description(card.name).trigger);
          expect(card.rulesText).toMatch(/^When .+, /);
        }
        const batches = [descriptions.slice(0, 4), descriptions.slice(4, 8), descriptions.slice(8)];
        const wire = await mount(page, presentation(base, phase, batches[0].map(row => row.name)));
        const scope = phase === 'ACTION' ? page.locator('#controls-panel-spells .prepared')
          : page.locator(phase === 'PREPARATION' ? '.preparation-panel .cards' : '.phase-panel .cards');
        for (const [index, batch] of batches.entries()) {
          if (index) wire.update(presentation(base, phase, batch.map(row => row.name)));
          if (phase === 'ACTION') await selectSpells(page);
          await expect(scope.locator('.spell')).toHaveCount(batch.length);
          for (const row of batch) {
            const card = spell(page, scope, row.name);
            await expect(card.locator('.spell-type')).toHaveAttribute('data-spell-type', row.type);
            await expectSpellType(card.locator('.spell-type'), row.type === 'TRAP' ? 'Trap' : 'Protection');
            await expectDescription(card, row, true);
            if (phase === 'PREPARATION' && ['Liquefy the Pain', 'Mending Ward'].includes(row.name)) {
              await test.info().attach(`${row.type.toLowerCase()}-${viewport.width}`, {
                body: await card.screenshot({ path: test.info().outputPath(`${row.type.toLowerCase()}-${viewport.width}.png`) }), contentType: 'image/png',
              });
            }
            if (row.name === 'Mending Ward') await expect(card.locator('.heal-effect')).toHaveText('♥ 2 heal');
            if (row.name === 'Threshold Snare') await expect(card.locator('.spell-effects')).not.toContainText(/enemy models in (?:target |your )?room/i);
            const original = canonical.find(item => item.name === row.name)!;
            const actual = phase === 'ACTION'
              ? Object.values(wire.state.players[0].prepared).find(slot => slot?.card.name === row.name)!.card
              : wire.state.players[0].hand.find(item => item.name === row.name)!;
            expect(actual.rulesText).toBe(original.rulesText); // Full card prose remains intact.
          }
          await noReady(scope);
          await expect(scope.locator('.spell-status')).toHaveCount(0);
          conserved(wire.state, ids);
        }

        // Nonreactive chips/prose are unchanged, including an ongoing card
        // whose leading When clause must NOT be split as a reactive trigger.
        const names = phase === 'ACTION' ? ['Peak of Agony', "Pilgrim's Mark", 'Rosefall']
          : ['Peak of Agony', "Pilgrim's Mark", 'Rosefall', 'Sovereign Wrath'];
        wire.update(presentation(base, phase, names, phase === 'ACTION'));
        if (phase === 'ACTION') await selectSpells(page);
        await expect(scope.locator('.spell')).toHaveCount(4);
        const peak = spell(page, scope, 'Peak of Agony');
        await expect(peak.locator('.spell-trigger')).toHaveCount(0);
        await expect(peak.locator('.spell-effects > span')).toHaveText([
          '⚔ Inflict 2 · enemy models in target room', '✺ Pink Tulip convert 2 · your mage · last damage from other mages', '✦ Pain 2',
        ]);
        await expect(peak.locator('.spell-rules')).toHaveText(base.library[0].cards.find(card => card.name === 'Peak of Agony')!.rulesText!);
        const ongoing = spell(page, scope, "Pilgrim's Mark");
        await expect(ongoing.locator('.spell-trigger')).toHaveCount(0);
        await expect(ongoing.locator('.spell-rules')).toHaveText('When you enter a different room, convert the live instability there to your color.');
        await expect(ongoing.locator('.spell-effects > span')).toHaveCount(0);
        await expectSpellType(ongoing.locator('.spell-type'), 'Contingency · Ongoing');
        const forgotten = spell(page, scope, 'Rosefall');
        await expect(forgotten).toHaveClass(/\bpowerful\b/);
        await expect(forgotten.locator('.spell-trigger')).toHaveCount(0);
        await expect(forgotten.locator('.spell-effects > span')).toHaveText(['◆ 3 instability', '⚔ Inflict 6 · enemy models in target room']);
        if (phase === 'ACTION') {
          const spent = spell(page, scope, 'Visceral Fire');
          await expect(spent).toBeDisabled();
          await expect(spent.locator('[data-spell-status="SPENT"]')).toBeVisible();
          await expect(spent.locator('.spell-status')).toHaveText('Spent');
          await expect(scope.locator('.spell-status')).toHaveCount(1);
          const held = spell(page, page.locator('.powerful-panel'), 'Sovereign Wrath');
          await expect(held).toBeVisible();
          await expect(held).toBeDisabled();
          await expect(held.locator('.spell-effects > span')).toHaveText(['◆ 1 instability', '⚔ Inflict 8']);
          await noReady(held);
        } else await expect(scope.locator('.spell-status')).toHaveCount(0);
        await noReady(scope);
        conserved(wire.state, ids);
        expect(wire.actions).toEqual([]);
        expect(wire.errors).toEqual([]);
      });
    }

    test('legacy JSON When/Whenever clauses, condition fallback and explicit custom effect-only copy are supported without duplicate triggers', async ({ page }) => {
      const initial = fixture();
      initial.phase = 'PREPARATION'; initial.currentPlayerId = null; initial.activation = null;
      const legacy = take(initial, 'Torment'); delete legacy.triggerText;
      const liquefy = take(initial, 'Liquefy the Pain'); delete liquefy.triggerText;
      const custom = take(initial, 'Mending Ward');
      Object.assign(custom, { name: 'Explicit effect-only ward', triggerText: 'When the explicit ward condition occurs',
        rulesText: 'Heal the chosen mage 2 wounds.', moments: [{ effect: 'DAMAGE', amount: 99 }] });
      const fallback = take(initial, 'Threshold Snare');
      delete fallback.triggerText;
      Object.assign(fallback, { name: 'Condition-only snare', rulesText: 'Reveal and deal 2 damage to the entering model.' });
      const preferred = take(initial, 'Mending Ward');
      Object.assign(preferred, { name: 'Explicit override ward', triggerText: 'When the new ward condition occurs',
        rulesText: 'When the old ward condition occurs, Heal the chosen mage 2 wounds.' });
      const whenever = take(initial, 'Threshold Snare'); delete whenever.triggerText;
      Object.assign(whenever, { name: 'Legacy Whenever snare', rulesText: 'Whenever an enemy enters a room, reveal and deal 2 damage to that model.' });
      initial.players[0].hand = [legacy, liquefy, custom, fallback, preferred, whenever];
      const originalRules = initial.players[0].hand.map(card => card.rulesText);
      const json = JSON.parse(JSON.stringify(initial)) as GameState;
      expect(json.players[0].hand[0]).not.toHaveProperty('triggerText');
      expect(json.players[0].hand[0].range).toBeNull(); // Real JSON transport, including legacy infinite range.
      const wire = await mount(page, json), scope = page.locator('.preparation-panel .cards');
      const rows: Description[] = [
        description('Torment'), { ...description('Liquefy the Pain'), trigger: 'When your mage is defeated' },
        { ...description('Mending Ward'), name: custom.name, trigger: 'When the explicit ward condition occurs', body: 'Heal the chosen mage 2 wounds.' },
        { ...description('Threshold Snare'), name: fallback.name, trigger: 'When an enemy model enters a room', body: 'Reveal and deal 2 damage to the entering model.' },
        { ...description('Mending Ward'), name: preferred.name, trigger: 'When the new ward condition occurs', body: 'Heal the chosen mage 2 wounds.' },
        { ...description('Threshold Snare'), name: whenever.name, trigger: 'Whenever an enemy enters a room' },
      ];
      await expect(scope.locator('.spell')).toHaveCount(6);
      for (const row of rows) await expectDescription(spell(page, scope, row.name), row, true);
      await expect(spell(page, scope, custom.name).locator('.spell-effects')).not.toContainText('99');
      await expect(spell(page, scope, preferred.name)).not.toContainText('When the old ward condition occurs');
      await expect(spell(page, scope, 'Torment').locator('.hint')).toContainText('Range ∞ · ignores line of sight');
      expect(wire.state.players[0].hand.map(card => card.rulesText)).toEqual(originalRules);
      conserved(wire.state);
      expect(wire.actions).toEqual([]); expect(wire.errors).toEqual([]);
    });

    test('activation confirmation, private Active entry and reminder share trigger-first copy; history and foreign privacy survive real activations', async ({ page }) => {
      const initial = fixture(), own = take(initial, 'Mending Ward'), foreign = take(initial, 'Threshold Snare');
      Object.assign(foreign, { name: 'Sealed foreign snare', triggerText: 'When the secret foreign condition occurs',
        rulesText: 'When the secret foreign condition occurs, apply the secret foreign effect.' });
      initial.players[0].prepared.slot1 = { card: own, used: false };
      initial.players[1].prepared.slot1 = { card: foreign, used: false };
      const wire = await mount(page, initial), row = description(own.name);
      await selectSpells(page);
      await spell(page, page.locator('.prepared'), own.name).click();
      const dialog = page.getByRole('dialog', { name: `Activate ${own.name}?`, exact: true });
      await expect(dialog).toBeVisible();
      await expectDescription(dialog, row, false);
      await expect(dialog).toContainText('No room or target is chosen');
      await expect(dialog.getByRole('combobox')).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden(); expect(wire.actions).toEqual([]);
      await selectSpells(page);
      await spell(page, page.locator('.prepared'), own.name).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Confirm activation', exact: true }).click();
      await expect.poll(() => wire.actions.length).toBe(1);
      await expect(dialog).toBeHidden();
      expect(wire.actions[0]).toEqual({ type: 'ACTIVATE_SPELL', playerId: 'p1', slot: 'slot1' });
      const active = structuredClone(wire.state.readiedSpells![0]);
      expect(active.card.rulesText).toBe(own.rulesText);
      for (const key of ['roomId', 'targetPlayerId', 'targetEvocationId']) expect(active).not.toHaveProperty(key);
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, sequencedSpellUsed: true });
      expect(wire.state.players[0].actionTokens).toBe(initial.players[0].actionTokens);
      expect(wire.projection.history).toMatchObject({ canUndo: true, undoLabel: 'Activate hidden spell' });
      await selectSpells(page);
      const ownEntry = page.locator(`.active-spell.own-spell[data-active-spell-id="${active.id}"]`);
      await expect(ownEntry).toBeVisible();
      await expectDescription(ownEntry, row, false);
      const prepared = spell(page, page.locator('.prepared'), own.name);
      await expect(prepared.locator('[data-spell-status="SPENT"]')).toHaveText('Spent');
      await noReady(prepared);
      await closeControls(page);
      const reminder = page.locator(`.trap-reminder[data-active-spell-id="${active.id}"]`);
      await expectDescription(reminder, row, false);

      await pressHistory(page, 'Undo action');
      await expect.poll(() => wire.actions.length).toBe(2);
      await selectSpells(page); // Active is mounted in the owning Spells dock.
      await expect(ownEntry).toHaveCount(0);
      await expect(prepared.locator('.spell-status')).toHaveCount(0);
      await expect(reminder).toHaveCount(0);
      await pressHistory(page, 'Redo action');
      await expect.poll(() => wire.actions.length).toBe(3);
      expect(wire.state.readiedSpells).toEqual([active]);
      await selectSpells(page);
      await expectDescription(ownEntry, row, false);
      await closeControls(page);
      await page.getByRole('button', { name: /^End turn\b/ }).click();
      await expect.poll(() => wire.actions.length).toBe(4);
      expect(wire.state.currentPlayerId).toBe('p2');
      wire.dispatch({ type: 'ACTIVATE_SPELL', playerId: 'p2', slot: 'slot1' });
      const foreignActive = wire.state.readiedSpells!.find(item => item.playerId === 'p2')!;
      expect(foreignActive.card.id).toBe(foreign.id);
      const masked = wire.projection.readiedSpells!.find(item => item.id === foreignActive.id)!;
      expect(Object.keys(masked).sort()).toEqual(['card', 'id', 'playerId']);
      expect(masked.card).toMatchObject({ name: 'Hidden spell', spellType: 'TRAP' });
      for (const key of ['triggerText', 'rulesText', 'trigger', 'triggerEffects']) expect(masked.card).not.toHaveProperty(key);
      expect(masked.card.id).not.toBe(foreign.id);
      await selectSpells(page);
      const foreignEntry = page.locator(`.active-spell.hidden-spell[data-active-spell-id="${foreignActive.id}"]`);
      await expect(foreignEntry).toBeVisible();
      await expect(foreignEntry.locator('strong')).toHaveText('Hidden active spell');
      await expectSpellType(foreignEntry.locator('.spell-type'), 'Trap · Active');
      await expect(foreignEntry.locator('.spell-trigger, .spell-effects, .spell-rules')).toHaveCount(0);

      wire.exposeForeignDetails();
      await selectSpells(page);
      // Positive acknowledgement before negative privacy checks: React must
      // have consumed the deliberately unmasked transmission, not the old one.
      await expect(foreignEntry.locator('small')).toContainText('projection probe');
      await expect(foreignEntry.locator('strong')).toHaveText('Hidden active spell');
      await expect(foreignEntry.locator('.spell-trigger, .spell-effects, .spell-rules')).toHaveCount(0);
      for (const secret of [foreign.name, foreign.triggerText!, 'apply the secret foreign effect.', foreign.id]) {
        expect(await page.locator('.app').evaluate(element => element.outerHTML)).not.toContain(secret);
      }
      await expectDescription(ownEntry, row, false);
      await closeControls(page);
      await expectDescription(reminder, row, false);
      await expect(page.locator('.trap-reminder')).toHaveCount(1);
      await expect(page.locator(`.trap-reminder[data-active-spell-id="${foreignActive.id}"]`)).toHaveCount(0);
      conserved(wire.state); expect(wire.errors).toEqual([]);
    });

    test('real Torment damage/reveal decisions show the trigger above rules without chips, then keep Spent after resolution', async ({ page }) => {
      const initial = fixture(), card = take(initial, 'Torment'), row = description('Torment');
      initial.players[0].prepared.slot1 = { card, used: false };
      const wire = await mount(page, initial);
      await selectSpells(page);
      await spell(page, page.locator('.prepared'), card.name).click();
      const activation = page.getByRole('dialog', { name: 'Activate Torment?', exact: true });
      await expect(activation).toBeVisible();
      await expectDescription(activation, row, false);
      await activation.getByRole('button', { name: 'Confirm activation', exact: true }).click();
      await expect.poll(() => wire.actions.length).toBe(1);
      await expect(activation).toBeHidden();
      const activeId = wire.state.readiedSpells![0].id;
      await closeControls(page);
      wire.dispatch({ type: 'END_ACTIVATION', playerId: 'p1' });
      wire.dispatch({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p2', kind: 'ATTACK' });
      wire.dispatch({ type: 'INFLICT_ATTACK', playerId: 'p2', targetId: 'p1' });
      const reveal = page.getByRole('dialog', { name: 'Reveal an active spell?', exact: true });
      await expect(reveal).toBeVisible();
      expect(wire.state.pendingDecision).toMatchObject({ kind: 'REACTIVE_SPELL', event: 'DAMAGE_DEALT', playerId: 'p1' });
      expect(wire.projection.pendingDecision).not.toHaveProperty('resume');
      await expectDescription(reveal, row, false);
      await expect(reveal.getByRole('status')).toContainText(`Target fixed by trigger: ${initial.players[1].name}`);
      await expect(reveal.getByRole('combobox', { name: 'Triggered spell target' })).toHaveCount(0);
      await reveal.getByRole('button', { name: 'Keep all hidden', exact: true }).click();
      await expect.poll(() => wire.actions.length).toBe(2);
      await expect(reveal).toBeHidden();
      expect(wire.state.readiedSpells![0].id).toBe(activeId);
      wire.dispatch({ type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p2' });
      wire.dispatch({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p2', kind: 'ATTACK' });
      wire.dispatch({ type: 'INFLICT_ATTACK', playerId: 'p2', targetId: 'p1' });
      await expect(reveal).toBeVisible();
      await expectDescription(reveal, row, false);
      await reveal.getByRole('button', { name: 'Reveal and resolve', exact: true }).click();
      await expect.poll(() => wire.actions.length).toBe(3);
      await expect(reveal).toBeHidden();
      expect(wire.actions[2]).toMatchObject({ type: 'RESPOND_REACTIVE_SPELL', playerId: 'p1', activeSpellId: activeId, targetId: 'p2' });
      expect(wire.state.readiedSpells).toEqual([]);
      expect(wire.state.players[0].wizard.damageCubes).toBe(4);
      expect(wire.state.players[1].wizard.damageCubes).toBe(2);
      expect(wire.state.evocations[0]).toMatchObject({ kind: 'SUCCUBUS', playerId: 'p1' });
      expect(wire.state.players[0].discard.find(item => item.id === card.id)?.rulesText).toBe(card.rulesText);
      expect(wire.state.feedbackEvents).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'SPELL_TRIGGERED', activeSpellId: activeId, cardName: 'Torment' })]));
      expect(wire.projection.history).toEqual({ canUndo: false, canRedo: false });
      await selectSpells(page);
      await expect(page.locator(`.active-spell[data-active-spell-id="${activeId}"]`)).toHaveCount(0);
      const spent = spell(page, page.locator('.prepared'), 'Torment');
      await expect(spent).toBeDisabled();
      await expect(spent.locator('[data-spell-status="SPENT"]')).toHaveText('Spent');
      await expectDescription(spent, row, true);
      await closeControls(page);
      await expect(page.locator(`.trap-reminder[data-active-spell-id="${activeId}"]`)).toHaveCount(0);
      conserved(wire.state); expect(wire.errors).toEqual([]);
    });
  });
}