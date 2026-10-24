import { test, expect, type Page } from '@playwright/test';
import { applyAction, createGame } from '../packages/game-engine/src/index';
import type { Card, GameState } from '../packages/game-engine/src/index';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { expectReference, selectStudyDraw } from './layout-ui';

// Observe genuine server projections; never intercept sockets or inject setup.
function observeState(page: Page) {
  let latest: GameState | undefined;
  page.on('websocket', socket => socket.on('framereceived', frame => {
    const message = JSON.parse(String(frame.payload));
    if (message.type === 'STATE') latest = message.state as GameState;
  }));
  return () => {
    expect(latest, 'A genuine authoritative state must have arrived').toBeDefined();
    return latest!;
  };
}

async function dismissOverlay(page: Page) {
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
}

async function expectNoStartingRecap(page: Page) {
  await expect(page.locator('.starting-deck-panel')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Starting (deck|grimoire)/i, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /Starting (deck|grimoire)/i, includeHidden: true })).toHaveCount(0);
  for (const name of ['Starting grimoire counts', 'Starting personal discard']) {
    await expect(page.getByRole('group', { name, exact: true, includeHidden: true })).toHaveCount(0);
  }
  // No recap card, concealed future draw, or empty placeholder card at setup.
  await expect(page.locator('.spell')).toHaveCount(0);
}

const hiddenCard = (index: number): Card => ({ id: `hidden-${index}`, name: 'Hidden spell',
  kind: 'SPELL', damage: 0, instability: 0, range: 0, target: 'MODEL' });
const masked = (count: number) => Array.from({ length: count }, (_, index) => hiddenCard(index));

function physicalCards(state: GameState): Card[] {
  return [...state.library.flatMap(deck => [...deck.cards, ...deck.discard]),
    ...state.powerfulDeck, ...state.removedCards,
    ...[...state.readiedSpells ?? [], ...state.ongoingSpells ?? []].map(active => active.card),
    ...state.players.flatMap(p => [...p.hand, ...p.personalDeck, ...p.discard,
      ...Object.values(p.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])];
}

function expectEmptyLobby(state: GameState) {
  expect(state.phase).toBe('LOBBY');
  for (const p of state.players) {
    expect(p.hand).toEqual([]); expect(p.personalDeck).toEqual([]); expect(p.discard).toEqual([]);
    expect(Object.values(p.prepared).every(slot => slot === null)).toBe(true);
  }
  expect(state.library.map(deck => [deck.cards.length, deck.discard.length])).toEqual([[36, 0], [36, 0], [36, 0]]);
  expect(physicalCards(state)).toHaveLength(120);
}

for (const viewport of [{ width: 1440, height: 1200 }, { width: 390, height: 844 }]) {
  test(`real starting schools allocate six masked deck cards and one public discard, then Study and prepare four at ${viewport.width}px`, async ({ browser }, info) => {
    test.setTimeout(120_000);
    const pages = await Promise.all([0, 1].map(() => browser.newPage({ viewport, reducedMotion: 'reduce' })));
    const states = pages.map(observeState), errors: string[] = [];
    const roomId = `schools-${viewport.width}-${info.workerIndex}-${info.retry}-${Date.now()}`;
    const choices = ['enchantment', 'transmutation'], names = ['School Warden', 'School Seer'];
    for (const page of pages) page.on('pageerror', error => errors.push(error.message));
    try {
      for (const [index, page] of pages.entries()) {
        await page.goto('/');
        await page.getByLabel('Mage name').fill(names[index]);
        await page.getByLabel('Room name').fill(roomId);
        await page.getByRole('button', { name: index ? 'Join room' : 'Create room', exact: true }).click();
        const select = page.getByRole('combobox', { name: 'Starting magic school', exact: true });
        await expect(select).toBeVisible(); await expect(select).toHaveValue('');
        await expect(page.getByRole('button', { name: 'Mark ready', exact: true })).toBeDisabled();
        const library = states[index]().library;
        expect(await select.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
          .toEqual(['', ...library.map(deck => deck.id)]);
        for (const deck of library) await expect(select.locator(`option[value="${deck.id}"]`)).toHaveText(deck.name);
        expectEmptyLobby(states[index]());
        await select.selectOption(choices[index]);
        await expect(page.getByRole('button', { name: 'Mark ready', exact: true })).toBeEnabled();
        expectEmptyLobby(states[index]());
      }

      // Public choices never reserve or reveal physical copies before all ready.
      const hostSelect = pages[0].getByRole('combobox', { name: 'Starting magic school', exact: true });
      await hostSelect.selectOption('cantrip');
      for (const page of pages) await expect(page.locator('.seat[data-player-id="p1"]')).toContainText('Cantrip');
      await hostSelect.selectOption(choices[0]);
      for (const [index, page] of pages.entries()) {
        await expect(page.locator('.seat[data-player-id="p1"]')).toContainText('Enchantment');
        await expect(page.locator('.seat[data-player-id="p2"]')).toContainText('Transmutation');
        await expect.poll(() => states[index]().players.map(p => p.startingSchoolId)).toEqual(choices);
        expectEmptyLobby(states[index]());
      }
      await pages[0].getByRole('button', { name: 'Mark ready', exact: true }).click();
      for (const [index, page] of pages.entries()) {
        await expect(page.locator('.lobby-count')).toHaveText('2 / 4 mages · 1 ready');
        expectEmptyLobby(states[index]());
        await expect(page.locator('.event-panel')).toHaveCount(0);
      }
      await info.attach(`school-lobby-${viewport.width}`, { body: await pages[0].locator('.lobby-panel').screenshot(), contentType: 'image/png' });
      await pages[1].getByRole('button', { name: 'Mark ready', exact: true }).click();
      const publicDiscards: Card[][] = [];
      for (const [index, page] of pages.entries()) {
        await expect(page.locator('.phase-track .current span')).toHaveText('(not) Black Rose');
        await dismissOverlay(page);
        const state = states[index]();
        expect(state.phase).toBe('BLACK_ROSE'); expect(state.round).toBe(1);
        expect(state.log.join('\n')).toContain('Round 1 · (not) Black Rose —');
        expect(state.log.join('\n')).not.toMatch(/(?<!\(not\) )Black Rose/i);
        expect(state.players.map(p => p.startingSchoolId)).toEqual(choices);
        for (const [seat, p] of state.players.entries()) {
          expect(p.hand).toEqual([]); expect(p.personalDeck).toEqual(masked(6));
          expect(p.discard).toHaveLength(1);
          expect(p.discard[0].schoolId).toBe(choices[seat]);
          expect(p.discard[0].id).not.toMatch(/^hidden-/);
          await expect(page.locator(`.player[data-player-id="${p.id}"] .mage-attributes > div`)
            .filter({ has: page.locator('dt', { hasText: /^Cards$/ }) }).locator('dd')).toHaveText('0/7');
        }
        expect(physicalCards(state)).toHaveLength(120);
        expect(state.library.map(deck => ({ id: deck.id, draw: deck.cards.length, discard: deck.discard.length })))
          .toEqual([{ id: 'cantrip', draw: 36, discard: 0 }, { id: 'transmutation', draw: 29, discard: 0 },
            { id: 'enchantment', draw: 29, discard: 0 }]);
        await expectNoStartingRecap(page);
        await expectReference(page, 'Grimoire 6 · Hand 0/7 · Personal discard 1');
        await expectNoStartingRecap(page);
        publicDiscards.push(state.players.flatMap(p => p.discard));
      }
      expect(publicDiscards[0]).toEqual(publicDiscards[1]);
      expect(new Set(publicDiscards[0].map(card => card.id)).size).toBe(2);

      // A real disconnect/rejoin must preserve the allocation, not deal seven again.
      const beforeReconnect = states[0]();
      await pages[1].reload();
      await expect.poll(() => states[0]().players[1].connected).toBe(false);
      await pages[1].getByLabel('Mage name').fill(names[1]);
      await pages[1].getByLabel('Room name').fill(roomId);
      await pages[1].getByRole('button', { name: 'Join room', exact: true }).click();
      for (const [index, page] of pages.entries()) {
        await expect.poll(() => states[index]().players.every(p => p.connected)).toBe(true);
        await expect(page.locator('.phase-track .current span')).toHaveText('(not) Black Rose');
        await dismissOverlay(page);
        const state = states[index]();
        expect(state.round).toBe(1); expect(state.usedEvent).toEqual(beforeReconnect.usedEvent);
        expect(state.library).toEqual(beforeReconnect.library);
        expect(state.powerfulDeck).toEqual(beforeReconnect.powerfulDeck);
        for (const [seat, p] of state.players.entries()) {
          expect(p.startingSchoolId).toBe(choices[seat]); expect(p.hand).toEqual([]);
          expect(p.personalDeck).toEqual(masked(6)); expect(p.discard).toEqual(beforeReconnect.players[seat].discard);
        }
        await expectNoStartingRecap(page);
      }

      await pages[0].getByRole('button', { name: /^Receive quests & begin Study/ }).click();
      const firstDraws: Card[][] = [];
      for (const [index, page] of pages.entries()) {
        await expect(page.locator('.phase-track .current span')).toHaveText('Study'); await dismissOverlay(page);
        const own = states[index]().players[index];
        expect(own.hand).toHaveLength(2); expect(own.personalDeck).toEqual(masked(4));
        expect(own.discard).toEqual(beforeReconnect.players[index].discard);
        expect(own.hand.every(card => card.schoolId === choices[index] && !card.id.startsWith('hidden-'))).toBe(true);
        firstDraws.push(own.hand);
      }
      expect(new Set([...firstDraws.flat(), ...publicDiscards[0]].map(card => card.id)).size).toBe(6);
      for (const [index, state] of states.entries()) {
        expect(state().players[1 - index].hand).toEqual(masked(2));
        for (const card of firstDraws[1 - index]) expect(JSON.stringify(state())).not.toContain(`"${card.id}"`);
      }
      for (const [index, page] of pages.entries()) {
        await selectStudyDraw(page, Array(4).fill('cantrip'));
        const cards = page.locator('.phase-panel .spell'); await expect(cards).toHaveCount(6);
        await expect(page.locator('.phase-panel .spell:disabled')).toHaveCount(2);
        await expect(page.locator('.phase-panel .spell:enabled')).toHaveCount(4);
        expect(states[index]().players[index].studyCardIds).toEqual(states[index]().players[index].hand.slice(2).map(card => card.id));
        expect(states[index]().players[1 - index]).not.toHaveProperty('studyCardIds');
        await cards.nth(4).click(); await cards.nth(5).click();
        await page.getByRole('button', { name: 'Discard selected (2/2)', exact: true }).click();
        await expect.poll(() => states[index]().players[index].hand.length).toBe(4);
        expect(states[index]().players[index].hand.slice(0, 2)).toEqual(firstDraws[index]);
        expect(states[index]().players[index].discard).toEqual(beforeReconnect.players[index].discard);
      }
      for (const page of pages) {
        await expect(page.locator('.phase-track .current span')).toHaveText('Preparation'); await dismissOverlay(page);
        await expect(page.locator('.hand-limit-panel')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Reduce your hand to 7 cards', exact: true })).toHaveCount(0);
      }
      for (const [index, page] of pages.entries()) {
        const preparations = page.locator('.phase-panel .spell'); await expect(preparations).toHaveCount(4);
        for (let card = 0; card < 4; card++) await preparations.nth(card).click();
        await page.getByRole('button', { name: 'Prepare spells', exact: true }).click();
        await expect.poll(() => states[index]().players[index].preparationDone).toBe(true);
        if (!index) for (const peer of pages) await expect(peer.locator('.phase-track .current span')).toHaveText('Preparation');
      }
      for (const [index, page] of pages.entries()) {
        await expect(page.locator('.phase-track .current span')).toHaveText('Action'); await dismissOverlay(page);
        const state = states[index](), own = state.players[index];
        expect(own.hand).toEqual([]); expect(own.personalDeck).toEqual(masked(4));
        expect(own.discard).toEqual(beforeReconnect.players[index].discard);
        expect(Object.values(own.prepared).every(slot => slot && !slot.used)).toBe(true);
        expect(Object.values(own.prepared).flatMap(slot => slot ? [slot.card] : [])).toHaveLength(4);
        expect(state.library.find(deck => deck.id === 'cantrip')!.cards).toHaveLength(28);
        expect(state.library.find(deck => deck.id === 'cantrip')!.discard).toHaveLength(4);
        expect(physicalCards(state)).toHaveLength(120);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      expect(errors, 'Real lobby, allocation, reconnect, Study and Preparation must render without errors').toEqual([]);
    } finally {
      await Promise.all(pages.map(page => page.close()));
    }
  });
}

// Projections intentionally cannot reveal the six future physical IDs. Check
// exact seven-ID allocation against real reducer/server fixtures separately.
for (const count of [2, 4]) {
  test(`${count} same-school mages conserve all 120 physical IDs and keep future decks private to every viewer`, () => {
    let game = createGame(count);
    const original = physicalCards(game).map(card => card.id).sort();
    expect(original).toHaveLength(120); expect(new Set(original).size).toBe(120);
    expectEmptyLobby(game);
    for (const p of game.players) p.connected = true;
    for (const p of game.players) {
      game = applyAction(game, { type: 'SELECT_STARTING_SCHOOL', playerId: p.id, schoolId: 'cantrip' });
      game = applyAction(game, { type: 'SET_READY', playerId: p.id, ready: true });
      expectEmptyLobby(game);
    }
    const supply = game.library.find(deck => deck.id === 'cantrip')!.cards;
    game = applyAction(game, { type: 'START_GAME', playerId: game.hostId });
    const allocated: Card[] = [];
    for (const [index, p] of game.players.entries()) {
      const seven = supply.slice(index * 7, index * 7 + 7);
      expect(seven).toHaveLength(7); expect(new Set(seven.map(card => card.id)).size).toBe(7);
      expect(p.hand).toEqual([]); expect(p.personalDeck).toEqual(seven.slice(0, 6));
      expect(p.discard).toEqual(seven.slice(6));
      expect(seven.every(card => card.schoolId === 'cantrip')).toBe(true);
      allocated.push(...seven);
    }
    expect(new Set(allocated.map(card => card.id)).size).toBe(count * 7);
    expect(game.library.find(deck => deck.id === 'cantrip')!.cards).toEqual(supply.slice(count * 7));
    expect(game.library.find(deck => deck.id === 'cantrip')!.cards).toHaveLength(36 - count * 7);
    for (const deck of game.library.filter(deck => deck.id !== 'cantrip')) expect(deck.cards).toHaveLength(36);
    expect(physicalCards(game).map(card => card.id).sort()).toEqual(original);
    const history = new ActionHistory(), snapshot = structuredClone(game);
    for (const viewer of [...game.players.map(p => p.id), null]) {
      const visible = publicState(game, viewer, history);
      expect(physicalCards(visible)).toHaveLength(120);
      for (const p of game.players) {
        const shown = visible.players.find(seat => seat.id === p.id)!;
        expect(shown.personalDeck).toEqual(masked(6)); expect(shown.hand).toEqual([]);
        expect(shown.discard).toEqual(p.discard);
        for (const card of p.personalDeck) expect(JSON.stringify(visible)).not.toContain(`"${card.id}"`);
      }
    }
    expect(game).toEqual(snapshot);
    game = applyAction(game, { type: 'ADVANCE_PHASE', playerId: game.hostId, expectedPhase: 'BLACK_ROSE', expectedRound: 1 });
    for (const [index, p] of game.players.entries()) {
      expect(p.hand).toEqual(supply.slice(index * 7, index * 7 + 2));
      expect(p.personalDeck).toHaveLength(4); expect(p.discard).toHaveLength(1);
    }
    expect(physicalCards(game).map(card => card.id).sort()).toEqual(original);
    // Only this Study's four library cards are eligible; the two personal
    // draws remain held. New Study discards return to their own school.
    for (const p of game.players) {
      const initialDiscard = p.discard, startingDraw = p.hand;
      game = applyAction(game, { type: 'DRAW_STUDY', playerId: p.id, deckId: 'transmutation' });
      expect(game.players.find(seat => seat.id === p.id)!.hand).toHaveLength(6);
      const drawn = game.players.find(seat => seat.id === p.id)!.hand.slice(2);
      expect(game.players.find(seat => seat.id === p.id)!.studyCardIds).toEqual(drawn.map(card => card.id));
      expect(() => applyAction(game, { type: 'DISCARD_STUDY', playerId: p.id, cardIds: startingDraw.map(card => card.id) }))
        .toThrow('Discard only spells drawn from the library this Study');
      game = applyAction(game, { type: 'DISCARD_STUDY', playerId: p.id, cardIds: drawn.slice(0, 2).map(card => card.id) });
      const own = game.players.find(seat => seat.id === p.id)!;
      expect(own.hand).toHaveLength(4); expect(own.personalDeck).toHaveLength(4);
      expect(own.discard).toEqual(initialDiscard);
      expect(own.hand.slice(0, 2)).toEqual(startingDraw);
      expect(game.library.find(deck => deck.id === 'transmutation')!.discard).toEqual(expect.arrayContaining(drawn.slice(0, 2)));
      expect(physicalCards(game).map(card => card.id).sort()).toEqual(original);
    }
    expect(game.phase).toBe('PREPARATION');
    expect(game.library.find(deck => deck.id === 'cantrip')!.discard).toHaveLength(0);
    expect(game.library.find(deck => deck.id === 'transmutation')!.discard).toHaveLength(count * 2);
    for (const p of game.players) {
      game = applyAction(game, { type: 'PREPARE_CARDS', playerId: p.id,
        preparedCardIds: p.hand.slice(0, 3).map(card => card.id), rapidCardId: p.hand[3].id });
    }
    expect(game.phase).toBe('ACTION');
    expect(game.players.every(p => p.hand.length === 0 && p.personalDeck.length === 4 && p.discard.length === 1)).toBe(true);
    expect(physicalCards(game).map(card => card.id).sort()).toEqual(original);
  });
}