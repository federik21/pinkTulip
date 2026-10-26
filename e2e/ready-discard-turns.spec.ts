import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  areAdjacent, createGame, getDiscardMoveCards, getReadyPreparedSlots,
  isInStartingRoom, summonEvocation,
} from '../packages/game-engine/src';
import type { Card, GameAction, GameState, PreparedCards } from '../packages/game-engine/src';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import {
  assignPreparationCard, closeChronicle, closeControls, openChronicle,
  pressHistory, selectControlTab, selectSpells,
} from './layout-ui';

type Slot = keyof PreparedCards;

function fixture(): GameState {
  const s = createGame(2);
  Object.assign(s, { gameId: 'ready-discard-turns', round: 1, phase: 'ACTION', currentPlayerId: 'p1', firstPlayerId: 'p1', log: [] });
  s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false, physicalAction: null };
  for (const p of s.players) { p.connected = true; p.wizard.position = { q: 0, r: 0 }; }
  s.players[0].name = 'Rose Warden'; s.players[1].name = 'Blue Seer';
  return s;
}

function take(s: GameState, name: string): Card {
  const deck = s.library.find(d => d.id === 'agony')!;
  const index = deck.cards.findIndex(c => c.name === name);
  expect(index, `available physical Agony copy: ${name}`).toBeGreaterThanOrEqual(0);
  return deck.cards.splice(index, 1)[0];
}

function prepare(s: GameState, slot: Slot, name: string): Card {
  const card = take(s, name);
  s.players[0].prepared[slot] = { card, used: false };
  return card;
}

function physicalCards(s: GameState): Card[] {
  // A spent preparation is only a reference: its physical card is in a discard,
  // an Active zone, or removed. Printed quest rewards are not physical spells.
  return [
    ...s.library.flatMap(d => [...d.cards, ...d.discard]), ...s.powerfulDeck, ...s.removedCards,
    ...s.players.flatMap(p => [...p.hand, ...p.personalDeck, ...p.discard,
      ...Object.values(p.prepared).flatMap(c => c && !c.used ? [c.card] : [])]),
    ...(s.readiedSpells ?? []).map(a => a.card), ...(s.ongoingSpells ?? []).map(a => a.card),
  ];
}

function conserved(s: GameState, ids?: string[]) {
  const cards = physicalCards(s);
  expect(cards).toHaveLength(48);
  expect(new Set(cards.map(c => c.id)).size).toBe(48);
  expect(cards.filter(c => c.schoolId === 'agony')).toHaveLength(36);
  expect(cards.filter(c => c.powerful)).toHaveLength(12);
  if (ids) expect(cards.map(c => c.id).sort()).toEqual(ids);
}

async function mount(page: Page, initial: GameState) {
  conserved(initial);
  const ids = physicalCards(initial).map(c => c.id).sort();
  let game = structuredClone(initial), publish = () => {};
  const history = new ActionHistory(), actions: GameAction[] = [], commands: GameAction[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.routeWebSocket('**', route => {
    publish = () => {
      conserved(game, ids);
      route.send(JSON.stringify({ type: 'STATE', state: publicState(game, 'p1', history) }));
    };
    route.onMessage(data => {
      const msg = JSON.parse(String(data));
      if (msg.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: game.gameId })); publish();
      } else if (msg.action) {
        commands.push(msg.action);
        try {
          game = history.apply(game, msg.action, 'p1'); actions.push(msg.action); publish();
          route.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: msg.requestId }));
        } catch (error) {
          errors.push(String(error));
          route.send(JSON.stringify({ type: 'ERROR', requestId: msg.requestId, message: String(error) }));
        }
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await dismissPhase(page);
  await expect(page.locator('.app')).toBeVisible();
  expect(errors).toEqual([]); // Also catches hooks accidentally placed below the entry early return.
  return {
    actions, commands, errors,
    get state() { return game; },
    publish() { publish(); },
    update(next: GameState) { history.clear(); game = structuredClone(next); publish(); },
  };
}

async function dismissPhase(page: Page) {
  await expect(page.locator('.phase-overlay')).toBeVisible();
  await page.locator('.phase-overlay').click();
  await expect(page.locator('.phase-overlay')).toBeHidden();
}

const discardSelect = (page: Page) => page.getByRole('combobox', { name: 'Card to discard to move', exact: true });
const hex = (page: Page, id: string) => page.locator(`.hex[data-room-id="${id}"]`);
const spell = (page: Page, name: string) => page.locator('.prepared .spell').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
const startLine = (name: string) => `${name} starts their turn: 2 actions total across physical actions, spell casts, and discard-to-move.`;
const endLine = (name: string) => `${name} ends their turn.`;
const boundaries = (s: GameState) => s.log.filter(line => / starts their turn:| ends their turn\.$/.test(line));

function adjacentRooms(s: GameState) {
  return s.board.rooms.filter(r => !r.startingFor && r.tiles.some(h => areAdjacent(s.players[0].wizard.position, h)));
}

async function choices(select: Locator, cards: Card[]) {
  await expect.poll(() => select.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value)))
    .toEqual(['', ...cards.map(c => c.id)]);
  await expect(select.locator('option')).toHaveText([
    cards.length ? 'Choose an unused prepared spell, then an adjacent hex' : 'No unused prepared spells to discard',
    ...cards.map(c => c.name),
  ]);
}

async function highlights(page: Page, rooms: GameState['board']['rooms']) {
  await expect.poll(() => page.locator('.hex.reachable').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-room-id')).sort()))
    .toEqual(rooms.map(r => r.id).sort());
  await expect(page.locator('.hex.start-room.reachable')).toHaveCount(0);
}

async function expectChronicle(page: Page, s: GameState, expected: string[]) {
  expect(boundaries(s)).toEqual(expected);
  const dialog = await openChronicle(page), log = dialog.getByRole('log');
  await expect(log.locator('.log-text')).toHaveText(s.log.slice(-45).reverse());
  await expect(log.locator('.log-text').filter({ hasText: / starts their turn:| ends their turn\.$/ })).toHaveText([...expected].reverse());
  for (const line of expected) {
    const owner = s.players.find(p => line.startsWith(`${p.name} `))!;
    const name = log.locator('.log-text').filter({ hasText: line }).locator('.log-mage');
    await expect(name).toHaveCount(1);
    await expect(name).toHaveText(owner.name);
    await expect(name).toHaveAttribute('data-player-id', owner.id);
    const glow = await name.evaluate(node => ({ color: getComputedStyle(node).color, shadow: getComputedStyle(node).textShadow }));
    expect(glow.color).toBe(owner.id === 'p1' ? 'rgb(251, 113, 133)' : 'rgb(96, 165, 250)');
    expect(glow.shadow).not.toBe('none'); expect(glow.shadow).toContain(glow.color);
  }
  await closeChronicle(page);
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px ready discard and Action turns`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });

    test('dropdown contains every unused numbered and Quick card, including later slots, never held, spent or Active cards', async ({ page }) => {
      const s = fixture(), p = s.players[0];
      const used = prepare(s, 'slot1', 'Shared Torture'); p.prepared.slot1!.used = true; s.library[0].discard.push(used);
      const next = prepare(s, 'slot2', 'Grim Torment'), future = prepare(s, 'slot3', 'Visceral Fire');
      const quick = prepare(s, 'rapid', 'Master of Pleasure'), held = take(s, 'Submission'); p.hand.push(held);
      const hidden = take(s, 'Torment'), ongoing = take(s, 'Pain Mark'), foreign = take(s, 'Liquefy the Pain');
      s.readiedSpells!.push({ id: 'own-hidden', playerId: 'p1', card: hidden }, { id: 'foreign-hidden', playerId: 'p2', card: foreign });
      s.ongoingSpells!.push({ id: 'ongoing-mark', playerId: 'p1', targetPlayerId: 'p2', card: ongoing });
      s.activeSpellOrder!.push('own-hidden', 'foreign-hidden', 'ongoing-mark'); p.hand.push(s.powerfulDeck.shift()!);
      const wire = await mount(page, s); await selectControlTab(page, 'Physical actions');
      await choices(discardSelect(page), [next, future, quick]); await expect(discardSelect(page)).toBeEnabled();
      await expect(page.getByRole('region', { name: 'Physical actions', exact: true })).toContainText(
        'Any numbered or Quick slot is eligible, even a later numbered spell or after casting a numbered spell this turn.',
      );
      expect(getReadyPreparedSlots(p, s.activation)).toEqual(['slot2', 'rapid']);
      expect(getDiscardMoveCards(p, s.activation)).toEqual([next, future, quick]);
      for (const card of [used, held, hidden, ongoing, foreign, p.hand[1]])
        await expect(discardSelect(page).locator(`option[value="${card.id}"]`)).toHaveCount(0);
      // An unused face-down preparation is eligible; an already Active card is not.
      await discardSelect(page).selectOption(quick.id); await closeControls(page);
      await highlights(page, adjacentRooms(s));
      expect(wire.commands).toEqual([]); expect(wire.errors).toEqual([]);
    });

    for (const slot of ['slot1', 'rapid'] as const) {
      test(`Forgotten ${slot === 'slot1' ? 'next numbered' : 'Quick'} is excluded while later normal numbered cards remain eligible`, async ({ page }) => {
        const s = fixture(), p = s.players[0], forgotten = s.powerfulDeck.shift()!;
        p.prepared[slot] = { card: forgotten, used: false };
        const normal = prepare(s, slot === 'slot1' ? 'rapid' : 'slot1', 'Grim Torment');
        const future = prepare(s, 'slot3', 'Visceral Fire');
        const wire = await mount(page, s); await selectControlTab(page, 'Physical actions');
        const eligible = slot === 'slot1' ? [future, normal] : [normal, future];
        await choices(discardSelect(page), eligible);
        expect(getReadyPreparedSlots(p, s.activation)).toEqual(['slot1', 'rapid']);
        expect(getDiscardMoveCards(p, s.activation)).toEqual(eligible);
        await expect(discardSelect(page).locator(`option[value="${forgotten.id}"]`)).toHaveCount(0);
        expect(wire.commands).toEqual([]); expect(wire.errors).toEqual([]);
      });
    }

    for (const occupied of [['slot2'], ['slot3'], ['slot1', 'slot3']] as const) {
      test(`numbered gaps ${occupied.join('/')} expose every unused discard without changing casting readiness`, async ({ page }) => {
        const s = fixture();
        const numbered = occupied.map((slot, i) => prepare(s, slot, i ? 'Visceral Fire' : 'Grim Torment'));
        const quick = prepare(s, 'rapid', 'Master of Pleasure');
        const wire = await mount(page, s); await selectControlTab(page, 'Physical actions');
        await choices(discardSelect(page), [...numbered, quick]);
        expect(getReadyPreparedSlots(s.players[0], s.activation)).toEqual([occupied[0], 'rapid']);
        expect(getDiscardMoveCards(s.players[0], s.activation)).toEqual([...numbered, quick]);
        await discardSelect(page).selectOption(numbered[0].id); await closeControls(page);
        const destination = adjacentRooms(s)[0]; await highlights(page, adjacentRooms(s)); await hex(page, destination.id).click();
        await expect.poll(() => wire.actions.length).toBe(1);
        expect(wire.actions[0]).toEqual({ type: 'DISCARD_EXIT', playerId: 'p1', cardId: numbered[0].id, destination: destination.tiles[0] });
        expect(wire.state.players[0].prepared[occupied[0]]!.used).toBe(true);
        expect(wire.state.activation).toMatchObject({ actionsUsed: 1, sequencedSpellUsed: false, discardedExit: true });
        expect(getReadyPreparedSlots(wire.state.players[0], wire.state.activation)).toEqual([...occupied.slice(1), 'rapid']);
        await selectControlTab(page, 'Physical actions'); await choices(discardSelect(page), [...numbered.slice(1), quick]);
        await expect(discardSelect(page)).toBeDisabled();
        expect(wire.errors).toEqual([]);
      });
    }

    for (const kind of ['cast', 'activate'] as const) {
      for (const discarded of ['slot3', 'rapid'] as const) {
        test(`a numbered ${kind === 'cast' ? 'cast' : 'activation'} still allows ${discarded === 'slot3' ? 'a later numbered' : 'an unused Quick'} discard for the second action without a token`, async ({ page }) => {
          const s = fixture(), first = prepare(s, 'slot1', kind === 'cast' ? 'Visceral Fire' : 'Master of Pleasure');
          const future = prepare(s, 'slot3', 'Grim Torment'), quick = prepare(s, 'rapid', 'Submission');
          const wire = await mount(page, s); await selectSpells(page); await spell(page, first.name).click();
          if (kind === 'cast') {
            await hex(page, 'room-0,0').click(); await page.getByRole('button', { name: `Cast ${first.name} here`, exact: true }).click();
          } else await page.getByRole('button', { name: 'Confirm activation', exact: true }).click();
          await expect.poll(() => wire.actions.length).toBe(1);
          expect(wire.actions[0]).toMatchObject({ type: kind === 'cast' ? 'CAST_SPELL' : 'ACTIVATE_SPELL', slot: 'slot1' });
          expect(wire.state.activation).toMatchObject({ actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: true, discardedExit: false });
          expect(wire.state.players[0].prepared.slot1).toEqual({ card: first, used: true });
          expect(wire.state.players[0].prepared.slot3).toEqual({ card: future, used: false });
          if (kind === 'activate') expect(wire.state.readiedSpells![0].card.id).toBe(first.id);
          expect(getReadyPreparedSlots(wire.state.players[0], wire.state.activation)).toEqual(['rapid']);
          expect(getDiscardMoveCards(wire.state.players[0], wire.state.activation)).toEqual([future, quick]);
          await selectSpells(page); await expect(spell(page, first.name)).toBeDisabled(); await expect(spell(page, future.name)).toBeDisabled();
          await expect(spell(page, quick.name)).toBeEnabled();
          await selectControlTab(page, 'Physical actions'); await choices(discardSelect(page), [future, quick]);
          await expect(discardSelect(page).locator(`option[value="${first.id}"]`)).toHaveCount(0);
          await expect(discardSelect(page)).toBeEnabled();
          const beforeDiscard = structuredClone(wire.state), card = discarded === 'slot3' ? future : quick;
          expect(beforeDiscard.currentPlayerId).toBe('p1'); expect(beforeDiscard.players[0].actionTokens).toBe(2);
          await discardSelect(page).selectOption(card.id); await closeControls(page);
          const destination = adjacentRooms(wire.state)[0]; await highlights(page, adjacentRooms(wire.state)); await hex(page, destination.id).click();
          await expect.poll(() => wire.actions.length).toBe(2);
          expect(wire.commands).toEqual(wire.actions);
          expect(wire.actions[1]).toEqual({ type: 'DISCARD_EXIT', playerId: 'p1', cardId: card.id, destination: destination.tiles[0] });
          const afterDiscard = structuredClone(wire.state);
          expect(afterDiscard.currentPlayerId).toBe('p2');
          expect(afterDiscard.players[0].prepared).toEqual({ ...beforeDiscard.players[0].prepared, [discarded]: { card, used: true } });
          expect(afterDiscard.players[0].wizard.position).toEqual(destination.tiles[0]);
          expect(afterDiscard.players[0].actionTokens).toBe(2);
          expect(afterDiscard.players[0].hand).toEqual(beforeDiscard.players[0].hand);
          expect(afterDiscard.library[0].discard).toEqual([...beforeDiscard.library[0].discard, card]);
          expect(afterDiscard.readiedSpells).toEqual(beforeDiscard.readiedSpells);
          expect(afterDiscard.ongoingSpells).toEqual(beforeDiscard.ongoingSpells);
          await highlights(page, []);
          await pressHistory(page, 'Undo action'); await expect.poll(() => wire.actions.length).toBe(3); expect(wire.state).toEqual(beforeDiscard);
          await selectControlTab(page, 'Physical actions'); await choices(discardSelect(page), [future, quick]);
          await expect(discardSelect(page)).toBeEnabled(); await expect(discardSelect(page)).toHaveValue('');
          await discardSelect(page).selectOption(card.id); await closeControls(page); await highlights(page, adjacentRooms(beforeDiscard));
          await pressHistory(page, 'Redo action'); await expect.poll(() => wire.actions.length).toBe(4); expect(wire.state).toEqual(afterDiscard);
          await highlights(page, []); expect(wire.commands).toEqual(wire.actions); expect(wire.errors).toEqual([]);
        });
      }
    }

    test('hand-only tokenless cell mage has no discard choice and is not forced to exit before End turn', async ({ page }) => {
      const s = fixture(), p = s.players[0]; p.actionTokens = 0; s.activation!.actionsUsed = 1;
      p.wizard.position = { ...s.board.rooms.find(r => r.startingFor === 'p1')!.tiles[0] };
      p.hand.push(take(s, 'Grim Torment'), take(s, 'Torment'), s.powerfulDeck.shift()!);
      const hand = structuredClone(p.hand), wire = await mount(page, s);
      await expect(page.locator('.cell-exit-reminder')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^End turn/ })).toBeEnabled();
      await selectControlTab(page, 'Physical actions'); await choices(discardSelect(page), []);
      await expect(discardSelect(page)).toBeDisabled(); await expect(discardSelect(page)).toHaveValue('');
      await expect(discardSelect(page).locator('option')).toHaveText(['No unused prepared spells to discard']);
      await expect(page.getByRole('region', { name: 'Physical actions', exact: true }).getByRole('button', { name: /^Explore\b/ })).toBeDisabled();
      await closeControls(page); await highlights(page, []); await hex(page, adjacentRooms(s)[0].id).click();
      expect(wire.commands).toEqual([]);
      await page.getByRole('button', { name: /^End turn/ }).click(); await expect.poll(() => wire.actions.length).toBe(1);
      expect(wire.commands).toEqual([{ type: 'END_ACTIVATION', playerId: 'p1' }]);
      expect(wire.state.currentPlayerId).toBe('p2'); expect(wire.state.players[0].hand).toEqual(hand);
      expect(isInStartingRoom(wire.state, wire.state.players[0])).toBe(true); expect(wire.errors).toEqual([]);
    });

    for (const discarded of ['slot1', 'slot3', 'rapid'] as const) {
      test(`prepared ${discarded} cell exit spends one action, no token or numbered quota, with exact Undo/Redo choices`, async ({ page }) => {
        const s = fixture(), p = s.players[0]; p.actionTokens = 0;
        p.wizard.position = { ...s.board.rooms.find(r => r.startingFor === 'p1')!.tiles[0] };
        const first = prepare(s, 'slot1', 'Grim Torment'), middle = prepare(s, 'slot2', 'Submission');
        const later = prepare(s, 'slot3', 'Visceral Fire'), quick = prepare(s, 'rapid', 'Master of Pleasure');
        const numbered = [['slot1', first], ['slot2', middle], ['slot3', later]] as const;
        const card = discarded === 'slot1' ? first : discarded === 'slot3' ? later : quick;
        p.hand.push(take(s, 'Submission'), s.powerfulDeck.shift()!);
        const destination = adjacentRooms(s)[0]; s.players[1].wizard.position = { ...destination.tiles[0] };
        const wire = await mount(page, s); await selectControlTab(page, 'Physical actions');
        await choices(discardSelect(page), [first, middle, later, quick]); await discardSelect(page).selectOption(card.id);
        await closeControls(page); await highlights(page, adjacentRooms(s)); await hex(page, destination.id).click();
        await expect.poll(() => wire.actions.length).toBe(1);
        const moved = structuredClone(wire.state);
        const remaining = [...numbered.filter(([slot]) => slot !== discarded).map(([, c]) => c), ...(discarded === 'rapid' ? [] : [quick])];
        expect(wire.commands).toEqual([{ type: 'DISCARD_EXIT', playerId: 'p1', cardId: card.id, destination: destination.tiles[0] }]);
        expect(moved.activation).toMatchObject({ actionsUsed: 1, spellsCast: 0, sequencedSpellUsed: false, discardedExit: true });
        expect(moved.players[0]).toMatchObject({ actionTokens: 0, hand: p.hand, wizard: { position: destination.tiles[0], damageCubes: 0 } });
        expect(moved.players[0].prepared).toEqual({ ...p.prepared, [discarded]: { card, used: true } });
        expect(moved.library[0].discard).toEqual([card]); expect(moved.players[0].discard).toEqual([]);
        expect(moved.readiedSpells).toEqual([]); expect(moved.ongoingSpells).toEqual([]); expect(moved.evocations).toEqual([]);
        expect(boundaries(moved)).toEqual([]); await highlights(page, []);
        await selectControlTab(page, 'Physical actions'); await choices(discardSelect(page), remaining); await expect(discardSelect(page)).toBeDisabled();
        // Eligibility is pure: the once-per-turn/action-cap gates belong to the UI/resolver.
        const beforeHelper = structuredClone(moved);
        expect(getDiscardMoveCards(moved.players[0], { ...moved.activation!, actionsUsed: 2 })).toEqual(remaining);
        expect(moved).toEqual(beforeHelper);
        await closeControls(page); await hex(page, adjacentRooms(moved)[0].id).click(); expect(wire.commands).toHaveLength(1);
        await pressHistory(page, 'Undo action'); await expect.poll(() => wire.actions.length).toBe(2); expect(wire.state).toEqual(s);
        await selectControlTab(page, 'Physical actions'); await choices(discardSelect(page), [first, middle, later, quick]);
        await expect(discardSelect(page)).toBeEnabled(); await expect(discardSelect(page)).toHaveValue('');
        await discardSelect(page).selectOption(card.id); await closeControls(page); await highlights(page, adjacentRooms(s));
        await pressHistory(page, 'Redo action'); await expect.poll(() => wire.actions.length).toBe(3); expect(wire.state).toEqual(moved);
        await highlights(page, []); await selectControlTab(page, 'Physical actions');
        await choices(discardSelect(page), remaining); await expect(discardSelect(page)).toBeDisabled(); await expect(discardSelect(page)).toHaveValue('');
        // Discarding a later slot leaves earlier cards unused and their casting order intact.
        const nextSlot = discarded === 'slot1' ? 'slot2' : 'slot1', next = discarded === 'slot1' ? middle : first;
        expect(getReadyPreparedSlots(wire.state.players[0], wire.state.activation)).toEqual([nextSlot, ...(discarded === 'rapid' ? [] : ['rapid'])]);
        await selectSpells(page);
        for (const [slot, candidate] of numbered) {
          if (slot === nextSlot) await expect(spell(page, candidate.name)).toBeEnabled();
          else await expect(spell(page, candidate.name)).toBeDisabled();
        }
        await spell(page, next.name).click();
        await hex(page, destination.id).click(); await page.getByRole('button', { name: `Cast ${next.name} here`, exact: true }).click();
        await expect.poll(() => wire.actions.length).toBe(4); expect(wire.actions[3]).toMatchObject({ type: 'CAST_SPELL', slot: nextSlot });
        expect(wire.state.currentPlayerId).toBe('p2'); expect(wire.state.players[0].actionTokens).toBe(0);
        expect(wire.state.players[0].hand).toEqual(p.hand); expect(wire.errors).toEqual([]);
      });
    }

    for (const invalidation of ['spent', 'returned-to-hand'] as const) {
      test(`a ${invalidation} broadcast clears a stale selected physical ID without move highlights or a command`, async ({ page }) => {
        const s = fixture(), selected = prepare(s, 'slot1', 'Grim Torment');
        const later = prepare(s, 'slot3', 'Visceral Fire'), quick = prepare(s, 'rapid', 'Master of Pleasure');
        const wire = await mount(page, s); await selectControlTab(page, 'Physical actions');
        const select = discardSelect(page), mounted = await select.elementHandle();
        await select.selectOption(selected.id); await highlights(page, adjacentRooms(s));
        const changed = structuredClone(wire.state), p = changed.players[0];
        if (invalidation === 'spent') { p.prepared.slot1!.used = true; changed.library[0].discard.push(p.prepared.slot1!.card); }
        else { p.hand.push(p.prepared.slot1!.card); p.prepared.slot1 = null; }
        wire.update(changed);
        // Do not unmount/reopen the dashboard: this must exercise broadcast-driven clearing.
        await expect(select).toBeVisible(); await expect(select).toHaveValue('');
        expect(await select.evaluate((node, original) => node === original, mounted)).toBe(true);
        await choices(select, [later, quick]);
        await expect(select).toBeEnabled(); await highlights(page, []);
        await expect(page.locator('.board-panel h2')).not.toHaveText('Discard to move · choose an adjacent space');
        wire.publish(); await expect(select).toHaveValue(''); await closeControls(page);
        await hex(page, adjacentRooms(changed)[0].id).click(); await expect(page.locator('.hex.selected')).toHaveCount(1);
        expect(wire.state).toEqual(changed); expect(wire.commands).toEqual([]); expect(wire.errors).toEqual([]);
      });
    }

    test('a numbered-quota broadcast preserves a selected later numbered discard and its move highlights', async ({ page }) => {
      const s = fixture(), first = prepare(s, 'slot1', 'Grim Torment');
      const later = prepare(s, 'slot3', 'Visceral Fire'), quick = prepare(s, 'rapid', 'Master of Pleasure');
      const wire = await mount(page, s); await selectControlTab(page, 'Physical actions');
      const select = discardSelect(page), mounted = await select.elementHandle();
      await choices(select, [first, later, quick]); await select.selectOption(later.id); await highlights(page, adjacentRooms(s));
      expect(getReadyPreparedSlots(s.players[0], s.activation)).toEqual(['slot1', 'rapid']);
      await expect(spell(page, first.name)).toBeEnabled();
      const changed = structuredClone(wire.state); changed.activation!.sequencedSpellUsed = true;
      wire.update(changed);
      // The mounted, hidden Spells panel confirms that React has received this broadcast.
      await expect(spell(page, first.name)).toBeDisabled();
      // Changing casting readiness must not invalidate an unused prepared discard.
      await expect(select).toBeVisible(); await expect(select).toHaveValue(later.id);
      expect(await select.evaluate((node, original) => node === original, mounted)).toBe(true);
      await choices(select, [first, later, quick]); await expect(select).toBeEnabled();
      expect(getReadyPreparedSlots(changed.players[0], changed.activation)).toEqual(['rapid']);
      expect(getDiscardMoveCards(changed.players[0], changed.activation)).toEqual([first, later, quick]);
      await highlights(page, adjacentRooms(changed));
      await expect(page.locator('.board-panel h2')).toHaveText('Discard to move · choose an adjacent space');
      wire.publish(); await expect(select).toHaveValue(later.id); await closeControls(page);
      await highlights(page, adjacentRooms(changed));
      await expect(page.locator('.board-panel h2')).toHaveText('Discard to move · choose an adjacent space');
      expect(wire.state).toEqual(changed); expect(wire.commands).toEqual([]); expect(wire.errors).toEqual([]);
    });

    for (const handoff of ['manual End turn', 'automatic second-action handoff'] as const) {
      test(`Chronicle has glowing names and one ordered start/end pair through ${handoff} and Undo/Redo`, async ({ page }) => {
        const s = fixture(); s.phase = 'PREPARATION'; s.currentPlayerId = null; s.activation = null;
        const first = take(s, 'Visceral Fire'), later = take(s, 'Grim Torment'), quick = take(s, 'Master of Pleasure');
        s.players[0].hand.push(first, later, quick);
        s.players[1].prepared.slot1 = { card: take(s, 'Submission'), used: false };
        s.players[1].prepared.rapid = { card: take(s, 'Liquefy the Pain'), used: false }; s.players[1].preparationDone = true;
        const wire = await mount(page, s);
        for (const [card, slot] of [[first, 1], [later, 3], [quick, 'Quick']] as const)
          await assignPreparationCard(page, page.locator('.preparation-panel .cards .spell').filter({ has: page.locator('strong', { hasText: card.name }) }), slot);
        await page.getByRole('button', { name: 'Done', exact: true }).click(); await dismissPhase(page);
        await expect.poll(() => wire.actions.length).toBe(1);
        await expectChronicle(page, wire.state, [startLine('Rose Warden')]);
        if (handoff === 'manual End turn') {
          await selectControlTab(page, 'Physical actions');
          await page.getByRole('region', { name: 'Physical actions', exact: true }).getByRole('button', { name: /^Explore\b/ }).click();
          await closeControls(page); await page.locator('.turn-banner').getByRole('button', { name: 'Finish action', exact: true }).click();
        } else {
          await selectSpells(page); await spell(page, first.name).click(); await hex(page, 'room-0,0').click();
          await page.getByRole('button', { name: `Cast ${first.name} here`, exact: true }).click();
        }
        await expect.poll(() => wire.actions.length).toBe(handoff === 'manual End turn' ? 3 : 2);
        const before = structuredClone(wire.state);
        await expectChronicle(page, before, [startLine('Rose Warden')]);
        if (handoff === 'manual End turn') await page.getByRole('button', { name: /^End turn/ }).click();
        else {
          await selectSpells(page); await spell(page, quick.name).click();
          await page.getByRole('button', { name: 'Confirm activation', exact: true }).click();
        }
        const count = handoff === 'manual End turn' ? 4 : 3;
        await expect.poll(() => wire.actions.length).toBe(count);
        const after = structuredClone(wire.state), expected = [startLine('Rose Warden'), endLine('Rose Warden'), startLine('Blue Seer')];
        expect(after.currentPlayerId).toBe('p2'); expect(after.log.slice(-2)).toEqual(expected.slice(-2));
        await expectChronicle(page, after, expected);
        for (let replay = 0; replay < 2; replay++) {
          await pressHistory(page, 'Undo action'); await expect.poll(() => wire.actions.length).toBe(count + replay * 2 + 1);
          expect(wire.state).toEqual(before); await expectChronicle(page, wire.state, [startLine('Rose Warden')]);
          await pressHistory(page, 'Redo action'); await expect.poll(() => wire.actions.length).toBe(count + replay * 2 + 2);
          expect(wire.state).toEqual(after); await expectChronicle(page, wire.state, expected);
        }
        const chronicle = await openChronicle(page);
        wire.publish(); wire.publish();
        await expect(chronicle.getByRole('log').locator('.log-text')).toHaveText(after.log.slice(-45).reverse());
        await expect(chronicle.getByRole('log').locator('.log-text').filter({ hasText: / starts their turn:| ends their turn\.$/ })).toHaveText([...expected].reverse());
        await closeChronicle(page); expect(wire.commands).toEqual(wire.actions); expect(wire.errors).toEqual([]);
      });
    }

    test('paid evocation completion delays the mage end pair, while free Evocation turns add no mage start/end logs', async ({ page }) => {
      const s = fixture(); s.activation!.actionsUsed = 1;
      const model = summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 })!;
      const wire = await mount(page, s); await selectControlTab(page, 'Evocations');
      await page.locator('#retinue-p1').getByRole('button', { name: /^Activate Cadaver #1/ }).click();
      await expect.poll(() => wire.actions.length).toBe(1);
      expect(wire.state.activation!.actionsUsed).toBe(2); await expectChronicle(page, wire.state, []);
      await page.locator('.turn-banner .evocation-controls').getByRole('button', { name: 'Finish evocation', exact: true }).click();
      await expect.poll(() => wire.actions.length).toBe(2);
      const expected = [endLine('Rose Warden'), startLine('Blue Seer')]; await expectChronicle(page, wire.state, expected);
      const free = structuredClone(wire.state); free.phase = 'EVOCATION'; free.currentPlayerId = 'p1'; free.activation = null;
      free.evocations.find(e => e.id === model.id)!.activated = false; wire.update(free); await dismissPhase(page);
      await selectControlTab(page, 'Evocations');
      await page.locator('#retinue-p1').getByRole('button', { name: /^Activate Cadaver #1/ }).click();
      await expect.poll(() => wire.actions.length).toBe(3); await expectChronicle(page, wire.state, expected);
      await page.locator('.turn-banner .evocation-controls').getByRole('button', { name: 'Finish evocation', exact: true }).click();
      await expect.poll(() => wire.actions.length).toBe(4); await dismissPhase(page);
      expect(wire.state.phase).toBe('CLEANUP'); await expectChronicle(page, wire.state, expected);
      expect(wire.commands).toEqual(wire.actions); expect(wire.errors).toEqual([]);
    });
  });
}
