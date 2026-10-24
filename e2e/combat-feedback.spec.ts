import { test, expect, type Locator, type Page } from '@playwright/test';
import { applyAction, BLACK_ROSE_ID, createDemoBoard, createGame, FEEDBACK_EVENT_LIMIT, getDefaultRoomsPerColor } from '../packages/game-engine/src/index';
import type { ActiveSpell, Card, Evocation, GameAction, GameFeedbackEvent, GameState } from '../packages/game-engine/src/index';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { openMageDetails, selectControlTab, selectSpells, viewRetinue } from './layout-ui';

type Cast = Extract<GameAction, { type: 'CAST_SPELL' }>;
type Selection = Omit<Cast, 'type' | 'playerId' | 'slot'>;
type Kind = GameFeedbackEvent['kind'];
type Event<K extends Kind> = Extract<GameFeedbackEvent, { kind: K }>;
type Reply = { action: GameAction; before: GameState; after: GameState };
const center = 'room-0,0', east = 'room-1,0';
const faults = new WeakMap<Page, string[]>();
const events = (game: GameState) => game.feedbackEvents ?? [];
const ofKind = <K extends Kind>(game: GameState, kind: K): Event<K>[] =>
  events(game).filter((event): event is Event<K> => event.kind === kind);
const mage = (game: GameState, id = 'p1') => game.players.find(player => player.id === id)!;
const room = (game: GameState, id = center) => game.board.rooms.find(chamber => chamber.id === id)!;
const ownerName = (game: GameState, id: string) => id === BLACK_ROSE_ID ? '(not) Black Rose' : mage(game, id).name;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const notifications = (page: Page) => page.locator('.combat-feedback[role="region"][aria-label="Combat notifications"]');
const popup = (page: Page, name?: string) => page.locator('.combat-popup').and(
  name ? page.getByRole('dialog', { name, exact: true }) : page.getByRole('dialog'));
const reminders = (page: Page) => page.getByRole('region', { name: 'Your trap and protection reminders', exact: true });
const reminder = (page: Page, active: ActiveSpell) => reminders(page).locator(`.trap-reminder[data-active-spell-id="${active.id}"]`);
const roster = (page: Page, id: string) => page.locator(`.player[data-player-id="${id}"]`);
const hex = (page: Page, id = center) => page.locator(`.hex[data-room-id="${id}"]`);
const pulse = (page: Page, event: Event<'DAMAGE'> | Event<'CONVERT'> | Event<'HEAL'>) => page.locator(
  `.board .feedback-pulse[data-event-id="${event.id}"][data-feedback-kind="${event.kind}"]` +
  `[data-target-id="${event.target.id}"][data-target-kind="${event.target.kind}"]`);

test.beforeEach(async ({ page }) => {
  const messages: string[] = []; faults.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  // Freeze browser time, not engine resolution. Assertions and tab switches must
  // not race the 2800ms balloon lifetime on slower mobile/CI browsers.
  await page.clock.install({ time: new Date('2026-10-24T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-24T12:00:01Z'));
});
test.afterEach(async ({ page }) => {
  expect(faults.get(page), 'No page errors or rejected authoritative fixture actions').toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

function turn(game: GameState, id = 'p1') {
  game.phase = 'ACTION'; game.currentPlayerId = id; game.evocationActivation = null;
  game.activation = { playerId: id, actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
    spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
}
function fixture(count = 4): GameState {
  const game = createGame(count);
  // createGame is a full-size Lobby preview; use the board START_GAME would
  // choose for this roster, including the smaller two-mage starting cells.
  game.board = createDemoBoard(getDefaultRoomsPerColor(count));
  game.gameId = 'combat-feedback'; game.round = 1; game.firstPlayerId = 'p1'; turn(game);
  game.players.forEach((player, i) => {
    player.name = ['Rose Warden', 'Blue Seer', 'Amber Sage', 'Green Weaver'][i];
    player.connected = player.ready = true; player.wizard.position = { q: 0, r: 0 };
    player.wizard.startingRoomId = game.board.rooms.find(chamber => chamber.startingFor === player.id)!.id;
  });
  game.board.rooms.forEach((chamber, i) => {
    if (!chamber.startingFor) chamber.name = chamber.id === center ? 'Rose Sanctum' : chamber.id === east ? 'Eastern Gallery' : `Runic Chamber ${i + 1}`;
  });
  return game;
}
function take(game: GameState, name: string): Card {
  for (const deck of game.library) {
    const index = deck.cards.findIndex(card => card.name === name);
    if (index >= 0) return deck.cards.splice(index, 1)[0];
  }
  throw new Error(`Missing canonical physical spell: ${name}`);
}
function prepare(game: GameState, name: string, slot: Cast['slot'] = 'rapid', id = 'p1') {
  const card = take(game, name); mage(game, id).prepared[slot] = { card, used: false }; return card;
}
function arm(game: GameState, name: string, id: string, selection: Selection): GameState {
  // Fixture-only turn selection; the active instance and its UUID are always
  // created by CAST_SPELL, never by constructing an ActiveSpell/event by hand.
  turn(game, id); prepare(game, name, 'rapid', id);
  return applyAction(game, { type: 'CAST_SPELL', playerId: id, slot: 'rapid', ...selection });
}
function servant(game: GameState, id = 'blue-cadaver'): Evocation {
  const model: Evocation = { id, playerId: 'p2', number: 1, name: 'Cadaver', archetype: 'UNDEAD',
    movement: 2, attack: 2, health: 2, passive: 'WOUNDED_FURY', position: { q: 0, r: 0 },
    damageCubes: 0, damageByPlayer: {}, activated: false };
  game.evocations.push(model); return model;
}
function syncCubes(game: GameState) {
  for (const player of game.players) {
    player.cubes.onWizard = game.players.reduce((n, victim) => n + (victim.wizard.damageByPlayer[player.id] ?? 0), 0);
    player.cubes.onEvocations = game.evocations.reduce((n, victim) => n + (victim.damageByPlayer[player.id] ?? 0), 0);
    player.cubes.onBoard = game.board.rooms.filter(chamber => !chamber.scored && !chamber.reconstructed)
      .reduce((n, chamber) => n + (chamber.cubesByPlayer[player.id] ?? 0), 0);
    player.cubes.available = 25 - player.cubes.onWizard - player.cubes.onEvocations - player.cubes.onBoard;
  }
}
function wound(game: GameState, id: string, ledger: Record<string, number>, black = 0) {
  const model = game.evocations.find(evocation => evocation.id === id) ?? mage(game, id).wizard;
  model.damageByPlayer = { ...ledger };
  model.damageCubes = Object.values(ledger).reduce((n, count) => n + count, 0) + black;
  if ('blackDamage' in model) model.blackDamage = black;
  syncCubes(game);
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
  expect(game.players.map(player => player.cubes)).toEqual(expected.players.map(player => player.cubes));
  for (const player of game.players) {
    expect(Object.values(player.cubes).every(n => Number.isInteger(n) && n >= 0)).toBe(true);
    expect(Object.values(player.cubes).reduce((sum, n) => sum + n, 0)).toBe(25);
  }
}

async function settle(page: Page) {
  // Also commits intervening WebSocket STATE/React work before negative checks.
  await page.clock.runFor(32);
}
async function mount(page: Page, initial: GameState, options: { unmaskedReadied?: boolean } = {}) {
  let game = structuredClone(initial), visible: GameState | undefined;
  const history = new ActionHistory(), replies: Reply[] = [], cards = physicalCards(game);
  let publish: () => void = () => { throw new Error('Fixture socket is not connected'); };
  conserved(game, cards);
  const reduce = (action: GameAction): Reply => {
    const before = game;
    // Includes real server-owned undo/redo; never reduce the masked public view.
    const after = history.apply(before, action, action.playerId);
    conserved(after, cards); game = after; return { action, before, after };
  };
  await page.routeWebSocket('**', route => {
    publish = () => {
      visible = publicState(game, 'p1', history);
      expect(visible.feedbackEvents).toEqual(game.feedbackEvents);
      if (options.unmaskedReadied) visible.readiedSpells = structuredClone(game.readiedSpells);
      route.send(JSON.stringify({ type: 'STATE', state: visible }));
    };
    route.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: game.gameId })); publish();
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
  await expect(page.locator('.app')).toBeVisible(); await settle(page);
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
  return { history, replies, get state() { return game; }, get visible() { return visible!; },
    async dispatch(action: GameAction) { const reply = reduce(action); publish(); await settle(page); return reply; },
    async repeat() { publish(); await settle(page); } };
}
type Wire = Awaited<ReturnType<typeof mount>>;
async function command(page: Page, wire: Wire, click: () => Promise<unknown>, action: GameAction) {
  const index = wire.replies.length; await click();
  await expect.poll(() => wire.replies.length).toBe(index + 1);
  expect(wire.replies[index].action).toEqual(action); await settle(page);
  return wire.replies[index];
}
async function dismiss(page: Page, name: string) {
  const dialog = popup(page, name);
  await expect(dialog).toBeVisible(); await expect(dialog).toHaveAttribute('aria-modal', 'false');
  await dialog.getByRole('button', { name: 'Dismiss event', exact: true }).click(); await settle(page);
}
async function silent(page: Page) {
  await settle(page);
  await expect(page.locator('.combat-popup')).toHaveCount(0);
  await expect(page.locator('.feedback-pulse')).toHaveCount(0);
  await expect(page.locator('.feedback-interrupt')).toHaveCount(0);
  await expect(page.locator('.feedback-svg-layer')).toHaveCount(0);
}
async function expectActiveCounts(page: Page, id: string, traps: number, protections: number) {
  const counts = roster(page, id).locator('.active-magic-counts');
  await expect(counts).toBeVisible();
  await expect(counts).toHaveText(`Trap: ${traps} · Protection: ${protections}`);
}
async function pulseText(page: Page, event: Event<'DAMAGE'> | Event<'CONVERT'> | Event<'HEAL'>) {
  const label = pulse(page, event);
  await expect(label).toHaveCount(1); await expect(label).toBeVisible();
  // toHaveText/textContent work for both HTML and SVG <text>; innerText does not.
  await expect(label).toHaveAttribute('aria-label', `${event.target.name}: ${event.kind === 'CONVERT'
    ? `↻ ${event.amount} converted` : `+${event.amount} ${event.kind === 'HEAL' ? 'healed' : 'damage'}`}`);
  await expect(label.locator('.feedback-number')).toHaveText(`${event.kind === 'CONVERT' ? '↻' : '+'}${event.amount}`);
  await expect(label.locator('.feedback-label')).toHaveText(event.kind === 'CONVERT' ? 'converted' : event.kind === 'HEAL' ? 'healed' : 'damage');
  return label;
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const label of await page.locator('.combat-popup, .trap-reminder').all()) {
    const box = await label.boundingBox(); expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}
async function unobscured(locator: Locator) {
  await locator.scrollIntoViewIfNeeded(); await expect(locator).toBeVisible();
  expect(await locator.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return !!hit && (node === hit || node.contains(hit));
  }), 'The control center must remain hit-testable while feedback is visible').toBe(true);
}

async function hexBounds(locator: Locator) {
  return locator.evaluate(node => {
    const { x, y, width, height } = (node as SVGGElement).getBBox();
    return { x, y, width, height };
  });
}

async function svgOverlay(page: Page) {
  const layer = page.locator('.board > .feedback-svg-layer');
  await expect(layer).toHaveCount(1);
  await expect(page.locator('.hex .feedback-pulse, .hex .feedback-interrupt')).toHaveCount(0);
  expect(await layer.evaluate(node => node === node.parentElement!.lastElementChild),
    'Feedback must paint last, outside every clickable hex').toBe(true);
  expect(await layer.evaluate(node => [node, ...node.querySelectorAll('*')]
    .every(element => getComputedStyle(element).pointerEvents === 'none'))).toBe(true);
  const placements = await layer.locator('.feedback-svg-position').evaluateAll(nodes => nodes.map(node => {
    const position = node as SVGGElement, svg = position.ownerSVGElement!;
    const anchor = Array.from(svg.querySelectorAll<SVGGElement>('.feedback-anchor')).find(candidate =>
      candidate.dataset.anchorKind === position.dataset.anchorKind && candidate.dataset.anchorId === position.dataset.anchorId);
    const expected = anchor?.getScreenCTM(), actual = position.getScreenCTM();
    const keys = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
    return { emptyAnchor: !!anchor && !anchor.childNodes.length, outsideHex: !position.closest('.hex'),
      sameTransform: !!expected && !!actual && keys.every(key => Math.abs(expected[key] - actual[key]) < .001) };
  }));
  expect(placements.length).toBeGreaterThan(0);
  for (const placement of placements) expect(placement).toEqual({ emptyAnchor: true, outsideHex: true, sameTransform: true });
}

async function roomBalloons(page: Page, triggers: Event<'SPELL_TRIGGERED'>[]) {
  const groups = new Map<string, Event<'SPELL_TRIGGERED'>[]>();
  for (const trigger of triggers) {
    const roomId = trigger.target?.roomId ?? trigger.roomId;
    expect(roomId, 'The engine supplies the actual public trigger room').toBeTruthy();
    groups.set(roomId!, [...groups.get(roomId!) ?? [], trigger]);
  }
  const balloons = page.locator('.board .feedback-interrupt');
  await expect(balloons).toHaveCount(groups.size);
  for (const [roomId, group] of groups) {
    const balloon = balloons.and(page.locator(`[data-room-id="${roomId}"]`));
    await expect(balloon).toHaveCount(1);
    await expect(balloon).toHaveAttribute('data-event-id', group[0].id);
    await expect(balloon).toHaveAttribute('data-target-id', group[0].target?.id ?? roomId);
    await expect(balloon).toHaveAttribute('data-more-interrupts', String(group.length - 1));
  }
}

async function animationSample(label: Locator, at: number) {
  return label.locator('.feedback-motion').evaluate((element, time) => {
    const animation = element.getAnimations().find(candidate => (candidate as CSSAnimation).animationName === 'feedback-rise');
    if (!animation) throw new Error('Expected a rising numeric balloon animation');
    animation.pause(); animation.currentTime = time;
    const style = getComputedStyle(element), transform = new DOMMatrixReadOnly(style.transform);
    return { y: transform.m42, opacity: Number(style.opacity), duration: animation.effect!.getTiming().duration,
      pointerEvents: style.pointerEvents, delay: style.animationDelay };
  }, at);
}

async function separated(labels: Locator) {
  const boxes = await labels.locator('.feedback-motion').evaluateAll(elements => elements.map(element => {
    for (const animation of element.getAnimations()) { animation.pause(); animation.currentTime = 900; }
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  expect(boxes.length).toBeGreaterThan(1);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    expect(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
      'Concurrent balloons on the same model must occupy separate lanes').toBe(true);
  }
}

async function recapText(page: Page, game: GameState, event: Event<'MAGE_DEFEATED'>) {
  const dialog = popup(page, 'Mage defeated');
  await expect(notifications(page)).toBeVisible(); await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'false');
  await expect(dialog).toContainText(event.target.name);
  await expect(dialog).toContainText(ownerName(game, event.sourceId));
  await expect(dialog).toContainText(room(game, event.respawnRoomId).name);
  await expect(dialog).toContainText(/respawn/i);
  // Human-readable owner/rank/cubes/points, not raw pN or mage-wizard IDs.
  // A row may be HTML text or nested elements; no new structural selector is required.
  for (const award of event.awards) {
    const name = escape(ownerName(game, award.playerId));
    await expect(dialog).toContainText(new RegExp(`${name}[\\s\\S]*?rank\\s*${award.rank}\\b`, 'i'));
    await expect(dialog).toContainText(new RegExp(`${name}[\\s\\S]*?${award.cubes}\\s*cubes?`, 'i'));
    await expect(dialog).toContainText(new RegExp(`${name}[\\s\\S]*?\\+?${award.points}\\s*(?:VP|points?)\\b`, 'i'));
  }
  await expect(dialog).toContainText(/returned cubes|cubes returned/i);
  for (const [id, count] of Object.entries(event.returnedCubes)) {
    await expect(dialog).toContainText(new RegExp(`(?:returned cubes[\\s\\S]*?${escape(ownerName(game, id))}[\\s\\S]*?\\b${count}\\b|${escape(ownerName(game, id))}[^\\n]*?${count}\\s*cubes? returned)`, 'i'));
  }
  await expect(dialog).not.toContainText(/\bp[1-4](?:-wizard)?\b|room-[-\d,]+/);
}

for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px combat feedback`, () => {
    test.use({ viewport, reducedMotion: 'no-preference' });

    test('lethal overkill captures the cleared ledger, solo bonus, returned cubes and named respawn', async ({ page }, info) => {
      const game = fixture(2); wound(game, 'p2', { p1: 9 });
      const wire = await mount(page, game);
      for (const player of game.players) await openMageDetails(page, player.id);
      await expect(roster(page, 'p2').getByRole('meter')).toHaveAttribute('aria-valuenow', '9');
      await wire.dispatch({ type: 'PUNCH', playerId: 'p1', targetId: 'p2' });
      const recap = ofKind(wire.state, 'MAGE_DEFEATED')[0];
      expect(ofKind(wire.state, 'DAMAGE')[0].amount).toBe(1);
      expect(recap).toMatchObject({ target: { id: 'p2', name: 'Blue Seer', roomId: center }, sourceId: 'p1',
        contributions: { p1: 10 }, returnedCubes: { p1: 10 }, bonusPlayerId: 'p1',
        awards: [{ playerId: 'p1', cubes: 10, rank: 1, tied: false, points: 4 }] });
      await recapText(page, wire.state, recap);
      const damage = ofKind(wire.state, 'DAMAGE')[0];
      await pulseText(page, damage);
      await expect(page.locator(`.board .feedback-svg-position[data-anchor-kind="ROOM"][data-anchor-id="${center}"]`)
        .locator(`.feedback-pulse[data-event-id="${damage.id}"]`)).toHaveCount(1);
      await svgOverlay(page);
      await popup(page).screenshot({path:info.outputPath('defeat-recap.png'),animations:'disabled'});
      await expect(popup(page)).toContainText(/(?:solo|exclusive|single.color|full.color)[\s\S]*?\+?1\s*(?:VP|point)/i);
      expect(mage(wire.state).victoryPoints).toBe(5); expect(mage(wire.state).kills).toBe(1);
      expect(mage(wire.state).cubes.available).toBe(25);
      expect(mage(wire.state, 'p2').wizard).toMatchObject({ damageCubes: 0, blackDamage: 0, damageByPlayer: {} });
      expect(mage(wire.state, 'p2').wizard.position).toEqual(room(wire.state, recap.respawnRoomId).tiles[0]);
      await expect(roster(page, 'p2').getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
      await expect(hex(page, recap.respawnRoomId).locator('[data-mage-id="p2"]')).toBeVisible();
      await wire.repeat(); await expect(page.locator('.combat-popup')).toHaveCount(1);
      await noOverflow(page); await dismiss(page, 'Mage defeated'); await wire.repeat();
      await page.clock.runFor(3000); await silent(page);
    });

    test('neutral finisher captures dense tied ranks without returning neutral cubes or awarding a solo bonus', async ({ page }) => {
      const game = fixture(); wound(game, 'p4', { p1: 4, p2: 4, p3: 1 });
      game.phase = 'CLEANUP'; game.currentPlayerId = null; game.activation = null;
      // Deterministic real Black Rose event, not a fabricated defeat notification.
      const blackEvent = game.eventDeck.find(event => event.kind === 'BLACK_DAMAGE')!;
      game.eventDeck = [{ ...blackEvent, amount: 1 }, ...game.eventDeck.filter(event => event.id !== blackEvent.id)];
      const wire = await mount(page, game);
      await wire.dispatch({ type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'CLEANUP', expectedRound: 1 });
      const overlay = page.locator('.phase-overlay');
      // The new phase arrives over the socket; wait for its React effect before
      // dismissing it. With the test clock paused, a missed overlay never expires.
      await expect(overlay).toBeVisible(); await overlay.click(); await expect(overlay).toBeHidden();
      const recap = ofKind(wire.state, 'MAGE_DEFEATED')[0];
      expect(recap).toMatchObject({ sourceId: BLACK_ROSE_ID, contributions: { p1: 4, p2: 4, p3: 1, [BLACK_ROSE_ID]: 1 },
        returnedCubes: { p1: 4, p2: 4, p3: 1 }, awards: [
          { playerId: 'p1', rank: 1, tied: true, points: 3 }, { playerId: 'p2', rank: 1, tied: true, points: 3 },
          { playerId: 'p3', rank: 2, tied: true, points: 1 }, { playerId: BLACK_ROSE_ID, rank: 2, tied: true, points: 1 },
        ] });
      expect(recap).not.toHaveProperty('bonusPlayerId'); expect(recap.returnedCubes).not.toHaveProperty(BLACK_ROSE_ID);
      await recapText(page, wire.state, recap); await expect(popup(page)).toContainText(/tied|tie/i);
      await expect(popup(page)).not.toContainText(/(?:solo|exclusive|full.color) bonus[^\n]*\+1/i);
      expect(wire.state.players.map(player => player.victoryPoints)).toEqual([3, 3, 1, 0]);
      expect(wire.state.blackRose).toEqual({ victoryPoints: 1, kills: 1 });
      await noOverflow(page); await dismiss(page, 'Mage defeated');
      await expect(page.locator('.combat-popup')).toHaveCount(0);
    });

    test('room trap and nested protections queue depth-first, dismiss individually, and leave controls usable', async ({ page }, info) => {
      let game = fixture(2);
      game = arm(game, 'Threshold Snare', 'p1', { roomId: east });
      game = arm(game, 'Thorn Retort', 'p1', {}); game = arm(game, 'Thorn Retort', 'p2', {}); turn(game, 'p2');
      const trapped = game.readiedSpells!.find(active => active.card.name === 'Threshold Snare')!;
      const wire = await mount(page, game);
      await expectActiveCounts(page, 'p1', 1, 1); await expectActiveCounts(page, 'p2', 0, 1);
      await expect(reminder(page, trapped)).toContainText('Threshold Snare');
      await expect(reminder(page, trapped)).toContainText('Eastern Gallery');
      await expect(reminder(page, trapped)).toContainText(/enemy.*enters|ENTER_ROOM/i);
      await reminders(page).screenshot({path:info.outputPath('trap-reminders.png'),animations:'disabled'});
      const bounds = await Promise.all([hexBounds(hex(page)), hexBounds(hex(page, east))]);
      await wire.dispatch({ type: 'EXPLORE', playerId: 'p2' });
      await wire.dispatch({ type: 'EXPLORE_STEP', playerId: 'p2', destination: { q: 1, r: 0 } });
      expect(events(wire.state).map(event => [event.kind, event.kind === 'SPELL_TRIGGERED' ? event.ownerId : 'sourceId' in event ? event.sourceId : '']))
        .toEqual([['SPELL_TRIGGERED', 'p1'], ['DAMAGE', 'p1'], ['SPELL_TRIGGERED', 'p2'], ['HEAL', 'p2'], ['DAMAGE', 'p2'], ['SPELL_TRIGGERED', 'p1'], ['HEAL', 'p1'], ['DAMAGE', 'p1']]);
      const triggers = ofKind(wire.state, 'SPELL_TRIGGERED'); expect(triggers).toHaveLength(3);
      const region = notifications(page);
      await expect(region).toHaveAttribute('data-queue-count', '3');
      // The entrant and its protection resolve in Eastern Gallery; the nested
      // retort on Rose Warden resolves in Rose Sanctum. Group actual public rooms,
      // never conflate all interrupts merely because they share one root action.
      await roomBalloons(page, triggers); await svgOverlay(page);
      await expect(page.locator('.board .interrupt-balloon-effect')).toHaveCount(0);
      expect(await Promise.all([hexBounds(hex(page)), hexBounds(hex(page, east))])).toEqual(bounds);
      await expect(popup(page, 'Trap triggered')).toContainText('Threshold Snare');
      await expect(popup(page)).toContainText('Rose Warden'); await expect(popup(page)).toContainText('Eastern Gallery');
      await popup(page).screenshot({path:info.outputPath('trap-triggered.png'),animations:'disabled'});
      await expect(reminder(page, trapped)).toHaveCount(0);
      await wire.repeat(); await expect(region).toHaveAttribute('data-queue-count', '3');
      await roomBalloons(page, triggers);
      await noOverflow(page);
      const evocationsTab = page.getByRole('tab', { name: 'Evocations', exact: true });
      await unobscured(evocationsTab); await evocationsTab.click();
      await expect(evocationsTab).toHaveAttribute('aria-selected', 'true');
      await unobscured(hex(page)); await hex(page).click();
      await expect(page.locator('.room-detail')).toContainText('Rose Sanctum');
      await unobscured(hex(page, east)); await hex(page, east).click();
      await expect(page.locator('.room-detail')).toContainText('Eastern Gallery');
      await svgOverlay(page);
      await dismiss(page, 'Trap triggered');
      await expect(region).toHaveAttribute('data-queue-count', '2');
      await expect(popup(page, 'Protection triggered')).toContainText('Thorn Retort');
      await expect(popup(page)).toContainText('Blue Seer');
      const effects = popup(page).locator('.interrupt-effect-line');
      await expect(effects).toHaveCount(0);
      await page.clock.runFor(500);
      await expect(effects).toHaveText(['Blue Seer: 1 wound healed.']);
      await page.clock.runFor(550);
      await expect(effects).toHaveText(['Blue Seer: 1 wound healed.', 'Rose Warden: 1 damage.']);
      expect(ofKind(wire.state, 'HEAL')[0].interruptId).toBe(triggers[1].id);
      expect(ofKind(wire.state, 'DAMAGE')[1].interruptId).toBe(triggers[1].id);
      await dismiss(page, 'Protection triggered');
      await expect(region).toHaveAttribute('data-queue-count', '1');
      await expect(popup(page, 'Protection triggered')).toContainText('Rose Warden');
      await expect(popup(page).locator('.interrupt-effect-line')).toHaveCount(0);
      await page.clock.runFor(1100);
      await expect(popup(page).locator('.interrupt-effect-line')).toHaveText(['Rose Warden: 1 wound healed.', 'Blue Seer: 1 damage.']);
      await roomBalloons(page, triggers); await svgOverlay(page);
      expect(await Promise.all([hexBounds(hex(page)), hexBounds(hex(page, east))])).toEqual(bounds);
      await dismiss(page, 'Protection triggered');
      await expect(page.locator('.combat-popup')).toHaveCount(0);
      await wire.repeat(); await page.clock.runFor(5000); await silent(page);
      expect(wire.state.readiedSpells).toEqual([]);
      for (const player of game.players) await expectActiveCounts(page, player.id, 0, 0);
      await selectSpells(page);
      await expect(page.locator('#controls-panel-spells .readied-spell')).toHaveCount(0);
    });

    for (const unmaskedReadied of [false, true]) {
      test(`own room/enemy-model reminders stay outside Spells; public foreign type never reveals a binding in ${unmaskedReadied ? 'deliberately unmasked' : 'publicState-masked'} readiness`, async ({ page }) => {
        let game = fixture(3); const model = servant(game);
        game = arm(game, 'Threshold Snare', 'p1', { roomId: east });
        game = arm(game, 'Mending Ward', 'p1', { targetPlayerId: 'p2' });
        game = arm(game, "Servant's Safeguard", 'p1', { targetEvocationId: model.id });
        game = arm(game, 'Thorn Retort', 'p3', {});
        game = arm(game, 'Spell Leech', 'p2', { roomId: center }); turn(game);
        const own = game.readiedSpells!.filter(active => active.playerId === 'p1');
        const foreign = game.readiedSpells!.filter(active => active.playerId !== 'p1');
        const wire = await mount(page, game, { unmaskedReadied });
        await silent(page); await expect(reminders(page)).toBeVisible();
        await expect(reminders(page).locator('.trap-reminder')).toHaveCount(3);
        for (const active of own) {
          const label = reminder(page, active);
          await expect(label).toBeVisible(); await expect(label).toContainText(active.card.name);
          const binding = active.targetEvocationId ? 'Blue Seer · Cadaver #1' : active.targetPlayerId ? 'Blue Seer' : 'Eastern Gallery';
          await expect(label).toContainText(binding);
          await expect(label).toContainText(active.card.trigger!.event === 'ENTER_ROOM' ? /enemy.*enters|ENTER_ROOM/i : /takes damage|DAMAGE_TAKEN/i);
          if (active.targetPlayerId || active.targetEvocationId) await expect(label).not.toContainText('Rose Sanctum');
        }
        for (const active of foreign) {
          await expect(reminders(page).locator(`[data-active-spell-id="${active.id}"]`)).toHaveCount(0);
          await expect(reminders(page)).not.toContainText(active.card.name);
          await expect(roster(page, active.playerId)).not.toContainText(active.card.name);
          if (!unmaskedReadied) {
            expect(wire.visible.readiedSpells!.find(hidden => hidden.id === active.id)).toEqual({
              id: active.id, playerId: active.playerId, card: {
                id: expect.stringMatching(/^hidden-\d+$/), name: 'Hidden spell', kind: 'SPELL',
                damage: 0, instability: 0, range: 0, target: 'MODEL', spellType: active.card.spellType,
              },
            });
          }
        }
        for (const player of game.players) await openMageDetails(page, player.id);
        const tabs = ['Physical actions', 'Spells', 'Evocations', 'Quests'] as const;
        await expect(page.getByRole('tablist', { name: 'Lodge controls', exact: true }).getByRole('tab')).toHaveText([...tabs]);
        for (const tab of tabs) {
          if (tab === 'Spells') await selectSpells(page); else await selectControlTab(page, tab);
          await expect(reminders(page)).toBeVisible();
          expect(await reminders(page).evaluate(node => !!node.closest('[role="tabpanel"]'))).toBe(false);
          await expectActiveCounts(page, 'p1', 1, 2);
          await expectActiveCounts(page, 'p2', 1, 0);
          await expectActiveCounts(page, 'p3', 0, 1);
          await noOverflow(page);
          if (tab === 'Spells') {
            const full = page.getByRole('region', { name: 'Active and ongoing spells', exact: true });
            await expect(full).toBeVisible(); await expect(full.locator('.readied-spell')).toHaveCount(5);
            for (const active of foreign) {
              const hidden = full.locator(`[data-active-spell-id="${active.id}"]`);
              await expect(hidden).not.toContainText(active.card.name);
              await expect(hidden.locator(`[data-spell-type="${active.card.spellType}"]`)).toHaveCount(1);
              await expect(hidden).not.toContainText(active.card.rulesText!);
              await expect(hidden).not.toContainText('Rose Sanctum');
              await expect(hidden.locator('small')).toHaveText(ownerName(game, active.playerId));
            }
          }
        }
        await wire.repeat(); await silent(page);
      });
    }

    test('real area DAMAGE balloons identify mage/evocation targets and keep full-roster damage bars authoritative', async ({ page }) => {
      const game = fixture(2), model = servant(game); prepare(game, 'Withering Mist');
      const wire = await mount(page, game);
      await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: center });
      const damage = ofKind(wire.state, 'DAMAGE');
      expect(damage.map(event => [event.target.kind, event.target.id, event.amount])).toEqual([['MAGE', 'p2', 1], ['EVOCATION', model.id, 1]]);
      for (const event of damage) await pulseText(page, event);
      await expect(page.locator('.combat-popup')).toHaveCount(0);
      await expect(roster(page, 'p2').getByRole('meter')).toHaveAttribute('aria-valuenow', '1');
      await expect(roster(page, 'p2').locator('.damage-segment[data-owner-id="p1"]')).toHaveAttribute('data-cubes', '1');
      await viewRetinue(page, 'p2');
      const card = page.locator(`.evocation-card[data-evocation-id="${model.id}"]`);
      await expect(card.getByRole('meter')).toHaveAttribute('aria-valuenow', '1');
      await expect(card.locator('.damage-segment[data-owner-id="p1"]')).toHaveAttribute('data-cubes', '1');
      await wire.repeat(); await expect(page.locator('.board .feedback-pulse')).toHaveCount(2);
      await page.clock.runFor(2400); for (const event of damage) await expect(pulse(page, event)).toBeVisible();
      await page.clock.runFor(450); await silent(page);
      await wire.repeat(); await silent(page); await noOverflow(page);
    });

    for (const kind of ['MAGE', 'EVOCATION', 'ROOM'] as const) {
      test(`real ${kind} CONVERT pulses show actual changed ownership, not extra wounds or instability`, async ({ page }) => {
        const game = fixture(3); let selection: Selection, name: string, targetId: string, total: number;
        if (kind === 'ROOM') {
          Object.assign(room(game), { instability: 4, cubesByPlayer: { p3: 2, [BLACK_ROSE_ID]: 2 } }); syncCubes(game);
          selection = { roomId: center }; name = 'Rewrite the Lodge'; targetId = center; total = 4;
        } else if (kind === 'EVOCATION') {
          const model = servant(game); wound(game, model.id, { p3: 1 });
          selection = { targetEvocationId: model.id }; name = 'Reclaimed Servant'; targetId = model.id; total = 1;
        } else {
          wound(game, 'p2', { p3: 2 }, 2);
          selection = { targetPlayerId: 'p2-wizard' }; name = "Mage's Due"; targetId = 'p2'; total = 4;
        }
        prepare(game, name); const before = structuredClone(game), wire = await mount(page, game);
        await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', ...selection });
        const converted = ofKind(wire.state, 'CONVERT'); expect(converted).toHaveLength(1);
        const event = converted[0];
        expect(event).toMatchObject({ target: { id: targetId, kind }, amount: kind === 'EVOCATION' ? 1 : 3, total });
        await pulseText(page, event); await expect(page.locator('.combat-popup')).toHaveCount(0);
        if (kind === 'ROOM') {
          expect(room(wire.state).instability).toBe(room(before).instability);
          await expect(hex(page).locator('.cube-count')).toHaveText(`◆ ${total}/${room(wire.state).instabilityLimit}`);
          await expect(hex(page).locator('.capacity-fill[data-owner-id="p1"]')).toHaveAttribute('data-cubes', '3');
          await expect(hex(page).locator(`.capacity-fill[data-owner-id="${BLACK_ROSE_ID}"]`)).toHaveAttribute('data-cubes', '1');
        } else {
          let meter: Locator;
          if (kind === 'EVOCATION') {
            expect(wire.state.evocations[0].damageCubes).toBe(before.evocations[0].damageCubes);
            await viewRetinue(page, 'p2');
            meter = page.locator(`.evocation-card[data-evocation-id="${targetId}"]`).getByRole('meter');
          } else {
            expect(mage(wire.state, 'p2').wizard.damageCubes).toBe(mage(before, 'p2').wizard.damageCubes);
            meter = roster(page, 'p2').getByRole('meter');
          }
          await expect(meter).toHaveAttribute('aria-valuenow', String(total));
          await expect(meter.locator('.damage-segment[data-owner-id="p1"]')).toHaveAttribute('data-cubes', String(event.amount));
          await expect(meter.locator('.damage-segment[data-owner-id="p3"]')).toHaveCount(0);
        }
        await wire.repeat(); await expect(page.locator('.board .feedback-pulse')).toHaveCount(1);
        await noOverflow(page); await page.clock.runFor(3000); await silent(page);
      });
    }

    for (const kind of ['MAGE', 'EVOCATION'] as const) for (const supply of ['available', 'empty'] as const) {
      test(`real UI own ${kind} conversion is legal and silent with ${supply} supply, but consumes its card/action`, async ({ page }) => {
        const game = fixture(3);
        const model = kind === 'EVOCATION' ? servant(game, 'rose-cadaver') : undefined;
        if (model) { model.playerId = 'p1'; model.health = 6; }
        const id = model?.id ?? 'p1', name = model ? 'Reclaimed Servant' : "Mage's Due";
        // Mixed ownership must not be rewritten, even when stock is available.
        wound(game, id, { p1: 1, p3: 1, [BLACK_ROSE_ID]: 1 }, model ? 0 : 1);
        if (supply === 'empty') {
          let remaining = mage(game).cubes.available;
          for (const chamber of game.board.rooms.filter(chamber => !chamber.startingFor)) {
            const cubes = Math.min(remaining, chamber.instabilityLimit);
            if (cubes) { chamber.instability = cubes; chamber.cubesByPlayer = { p1: cubes }; }
            remaining -= cubes;
          }
          expect(remaining).toBe(0); syncCubes(game);
        }
        expect(mage(game).cubes.available).toBe(supply === 'empty' ? 0 : 24);
        const card = prepare(game, name, 'slot1'), before = structuredClone(game);
        const wire = await mount(page, game); await silent(page); await selectSpells(page);
        const button = page.locator('.prepared .spell').filter({ has: page.getByText(name, { exact: true }) });
        await expect(button).toBeEnabled(); await button.click(); await hex(page).click();
        const select = page.getByRole('combobox', { name: 'Spell target model', exact: true });
        await expect(select.locator(`option[value="${id}"]`)).toHaveCount(1);
        await select.selectOption(id);
        const cast = page.locator('.room-detail').getByRole('button', { name: /^Cast / });
        await expect(cast).toBeEnabled();
        await command(page, wire, () => cast.click(), { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1',
          ...(model ? { targetEvocationId: id } : { targetPlayerId: id }) });
        const after = wire.state;
        expect(after.players.map(player => player.wizard)).toEqual(before.players.map(player => player.wizard));
        expect(after.evocations).toEqual(before.evocations);
        expect(after.players.map(player => player.cubes)).toEqual(before.players.map(player => player.cubes));
        expect(after.board).toEqual(before.board);
        expect(after.readiedSpells).toEqual(before.readiedSpells);
        expect(after.ongoingSpells).toEqual(before.ongoingSpells);
        expect(after.activeSpellOrder).toEqual(before.activeSpellOrder);
        expect(events(after)).toEqual(events(before)); expect(ofKind(after, 'CONVERT')).toEqual([]);
        expect(mage(after).prepared.slot1).toEqual({ card, used: true });
        expect(after.library.find(deck => deck.id === card.schoolId)!.discard).toContainEqual(card);
        expect(after.activation).toMatchObject({ actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: true });
        expect(mage(after).actionTokens).toBe(mage(before).actionTokens);
        await expect(button).toHaveClass(/used/);
        await expect(page.locator('.phase-panel .badge')).toHaveText('1 turn actions left');
        if (model) await viewRetinue(page, 'p1');
        const damage = model ? page.locator(`.evocation-card[data-evocation-id="${id}"]`) : roster(page, 'p1');
        await expect(damage.getByRole('meter')).toHaveAttribute('aria-valuenow', String(model ? model.damageCubes : mage(before).wizard.damageCubes));
        for (const owner of ['p1', 'p3', BLACK_ROSE_ID]) {
          await expect(damage.locator(`.damage-segment[data-owner-id="${owner}"]`)).toHaveAttribute('data-cubes', owner === BLACK_ROSE_ID && !model ? '2' : '1');
        }
        await silent(page); await wire.repeat(); await silent(page);
        await command(page, wire, () => page.getByRole('button', { name: 'Undo action', exact: true }).click(), { type: 'UNDO_ACTION', playerId: 'p1' });
        expect(wire.state).toEqual(before); await silent(page);
        await command(page, wire, () => page.getByRole('button', { name: 'Redo action', exact: true }).click(), { type: 'REDO_ACTION', playerId: 'p1' });
        expect(wire.state).toEqual(after); await silent(page);
      });
    }

    test('own SELF conversion is skipped before healing and returns cubes to their original owners', async ({ page }) => {
      const game = fixture(3); wound(game, 'p1', { p2: 1, p3: 2, [BLACK_ROSE_ID]: 1 }, 1);
      const card = prepare(game, "Alchemist's Refuge", 'slot1'), wire = await mount(page, game);
      await selectSpells(page);
      const button = page.locator('.prepared .spell').filter({ has: page.getByText(card.name, { exact: true }) });
      await button.click();
      const cast = page.locator('.room-detail').getByRole('button', { name: `Cast ${card.name} on yourself`, exact: true });
      await expect(cast).toBeEnabled();
      await command(page, wire, () => cast.click(), { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p1' });
      expect(mage(wire.state).wizard).toMatchObject({ damageCubes: 3, damageByPlayer: { p3: 1, [BLACK_ROSE_ID]: 1 }, blackDamage: 1 });
      expect(mage(wire.state).cubes).toEqual(mage(game).cubes);
      expect(mage(wire.state, 'p2').cubes.available).toBe(25);
      expect(mage(wire.state, 'p3').cubes.available).toBe(24);
      expect(events(wire.state).map(event => event.kind)).toEqual(['HEAL']);
      expect(ofKind(wire.state, 'HEAL')[0]).toMatchObject({ amount: 2, sourceId: 'p1', target: { kind: 'MAGE', id: 'p1' } });
      expect(ofKind(wire.state, 'CONVERT')).toEqual([]);
      await pulseText(page, ofKind(wire.state, 'HEAL')[0]);
      await expect(page.locator('.feedback-pulse[data-feedback-kind="CONVERT"]')).toHaveCount(0);
      expect(mage(wire.state).prepared.slot1).toEqual({ card, used: true });
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, spellsCast: 1 });
      expect(wire.state.board).toEqual(game.board);
      await page.clock.runFor(3000); await silent(page);
    });

    test('no-op conversion, dummy damage and initial historic defeat are silent', async ({ page }) => {
      let game = fixture(2); wound(game, 'p2', { p1: 8 });
      game = applyAction(game, { type: 'PUNCH', playerId: 'p1', targetId: 'p2' });
      expect(events(game).map(event => event.kind)).toEqual(['DAMAGE', 'MAGE_DEFEATED']);
      // A reconnect starts with real prior DAMAGE/DEFEAT facts and a respawned
      // target. The hook must baseline every ID on its first non-null STATE.
      turn(game); mage(game, 'p2').wizard.position = { q: 0, r: 0 };
      prepare(game, 'Stolen Sigil', 'slot1'); prepare(game, 'Arcane Bolt');
      const wire = await mount(page, game), historic = structuredClone(events(game));
      await silent(page); await wire.repeat(); await silent(page);
      await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
      expect(events(wire.state)).toEqual(historic); await silent(page);
      await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: center, dummy: true });
      expect(events(wire.state)).toEqual(historic); await silent(page);
    });

    test('bound protection expires on lethal damage without a false trigger popup or reminder', async ({ page }) => {
      let game = fixture(2); mage(game, 'p2').wizard.health = 2;
      game = arm(game, 'Mending Ward', 'p1', { targetPlayerId: 'p2' }); turn(game);
      const active = game.readiedSpells![0], wire = await mount(page, game);
      await expect(reminder(page, active)).toContainText('Blue Seer');
      await wire.dispatch({ type: 'PUNCH', playerId: 'p1', targetId: 'p2' });
      expect(events(wire.state).map(event => event.kind)).toEqual(['DAMAGE', 'MAGE_DEFEATED']);
      expect(wire.state.readiedSpells).toEqual([]);
      await expect(reminder(page, active)).toHaveCount(0);
      for (const player of game.players) await expectActiveCounts(page, player.id, 0, 0);
      await expect(popup(page, 'Protection triggered')).toHaveCount(0);
      await expect(notifications(page)).toHaveAttribute('data-queue-count', '1');
      await expect(popup(page, 'Mage defeated')).toContainText('Blue Seer');
      await dismiss(page, 'Mage defeated'); await wire.repeat(); await page.clock.runFor(3000); await silent(page);
    });

    test('ongoing conversion pulses without a popup or replay, and Cleanup retires it silently', async ({ page }) => {
      let game = fixture(2);
      Object.assign(room(game, east), { instability: 2, cubesByPlayer: { [BLACK_ROSE_ID]: 2 } });
      game = arm(game, "Pilgrim's Mark", 'p1', {}); turn(game);
      const active = game.ongoingSpells![0];
      const wire = await mount(page, game); await silent(page);
      await selectSpells(page);
      const ongoing = page.locator(`#controls-panel-spells .ongoing-spell[data-active-spell-id="${active.id}"]`);
      await expect(ongoing).toBeVisible(); await expect(ongoing).toContainText(active.card.name);
      await wire.dispatch({ type: 'EXPLORE', playerId: 'p1' });
      await wire.dispatch({ type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 1, r: 0 } });
      expect(events(wire.state).map(event => event.kind)).toEqual(['SPELL_TRIGGERED', 'CONVERT']);
      expect(ofKind(wire.state, 'SPELL_TRIGGERED')[0]).toMatchObject({ ongoing: true, spellType: 'CONTINGENCY' });
      await expect(page.locator('.combat-popup')).toHaveCount(0);
      await pulseText(page, ofKind(wire.state, 'CONVERT')[0]);
      const resolved = structuredClone(events(wire.state));
      await page.clock.runFor(3000); await silent(page);
      await command(page, wire, () => page.getByRole('button', { name: 'Undo action', exact: true }).click(), { type: 'UNDO_ACTION', playerId: 'p1' });
      expect(events(wire.state)).toEqual([]); await silent(page);
      await command(page, wire, () => page.getByRole('button', { name: 'Redo action', exact: true }).click(), { type: 'REDO_ACTION', playerId: 'p1' });
      expect(events(wire.state)).toEqual(resolved); await silent(page);
      await wire.dispatch({ type: 'END_EXPLORE', playerId: 'p1' });
      // Spend the three remaining physical tokens without moving, drawing or
      // fabricating a Cleanup snapshot. There are no evocations in this fixture.
      for (let i = 0; i < 3; i++) {
        expect(wire.state.phase).toBe('ACTION');
        const playerId = wire.state.currentPlayerId!;
        await wire.dispatch({ type: 'BEGIN_PHYSICAL_ACTION', playerId, kind: 'EXPLORE' });
        await wire.dispatch({ type: 'SKIP_PHYSICAL_EFFECTS', playerId });
      }
      expect(wire.state.phase).toBe('CLEANUP'); expect(wire.state.ongoingSpells).toEqual([]);
      expect(wire.state.activeSpellOrder).not.toContain(active.id);
      expect(wire.state.library.find(deck => deck.id === active.card.schoolId)!.discard).toContainEqual(active.card);
      expect(events(wire.state)).toEqual(resolved);
      const overlay = page.locator('.phase-overlay'); if (await overlay.isVisible()) await overlay.click();
      await selectSpells(page); await expect(ongoing).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Active and ongoing spells', exact: true })).toHaveCount(0);
      for (const player of game.players) await expectActiveCounts(page, player.id, 0, 0);
      await wire.repeat(); await silent(page);
    });

    test('bounded feed, duplicate STATE and exact undo/redo never replay; a new branch with fresh UUIDs does', async ({ page }) => {
      const game = fixture(2); wound(game, 'p2', { p1: 8 });
      // Only this retention test synthesizes IDs. Payloads come from an actual
      // engine hit; all live defeat/pulse/branch events below use engine UUIDs.
      const template = ofKind(applyAction(fixture(2), { type: 'PUNCH', playerId: 'p1', targetId: 'p2' }), 'DAMAGE')[0];
      game.feedbackEvents = Array.from({ length: FEEDBACK_EVENT_LIMIT }, (_, i) => ({ ...structuredClone(template), id: `overflow-baseline-${i}` }));
      const wire = await mount(page, game); await silent(page);
      const action: GameAction = { type: 'PUNCH', playerId: 'p1', targetId: 'p2' };
      await wire.dispatch(action);
      const resolved = structuredClone(wire.state), newEvents = events(resolved).slice(-2);
      expect(events(resolved)).toHaveLength(FEEDBACK_EVENT_LIMIT);
      expect(newEvents.map(event => event.kind)).toEqual(['DAMAGE', 'MAGE_DEFEATED']);
      for (const event of newEvents) expect(event.id).toMatch(/^[0-9a-f-]{36}$/i);
      await expect(notifications(page)).toHaveAttribute('data-queue-count', '1');
      await expect(page.locator('.board .feedback-pulse')).toHaveCount(1);
      await wire.repeat(); await wire.repeat();
      await expect(notifications(page)).toHaveAttribute('data-queue-count', '1');
      await dismiss(page, 'Mage defeated'); await page.clock.runFor(3000); await silent(page);
      for (let replay = 0; replay < 2; replay++) {
        await command(page, wire, () => page.getByRole('button', { name: 'Undo action', exact: true }).click(), { type: 'UNDO_ACTION', playerId: 'p1' });
        expect(wire.state).toEqual(game); await silent(page);
        await command(page, wire, () => page.getByRole('button', { name: 'Redo action', exact: true }).click(), { type: 'REDO_ACTION', playerId: 'p1' });
        expect(wire.state).toEqual(resolved); expect(events(wire.state).slice(-2)).toEqual(newEvents);
        await wire.repeat(); await silent(page);
      }
      await command(page, wire, () => page.getByRole('button', { name: 'Undo action', exact: true }).click(), { type: 'UNDO_ACTION', playerId: 'p1' });
      await silent(page); await wire.dispatch(action);
      const branch = events(wire.state).slice(-2);
      expect(branch.map(({ id: _id, ...fact }) => fact)).toEqual(newEvents.map(({ id: _id, ...fact }) => fact));
      for (const event of branch) expect(newEvents.map(old => old.id)).not.toContain(event.id);
      await expect(popup(page, 'Mage defeated')).toBeVisible();
      await expect(notifications(page)).toHaveAttribute('data-queue-count', '1');
      await pulseText(page, ofKind(wire.state, 'DAMAGE').at(-1)!);
      await dismiss(page, 'Mage defeated'); await page.clock.runFor(3000); await wire.repeat(); await silent(page);
      expect(wire.visible.history?.canRedo).toBe(false);
    });

    test('numeric balloons really rise and fade for 2.8 seconds on SVG models and evocation cards', async ({ page }) => {
      const game = fixture(2), model = servant(game); prepare(game, 'Withering Mist');
      const wire = await mount(page, game);
      await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: center });
      const event = ofKind(wire.state, 'DAMAGE').find(effect => effect.target.id === model.id)!;
      await viewRetinue(page, 'p2');
      const board = await pulseText(page, event);
      const card = page.locator(`.evocation-card[data-evocation-id="${model.id}"] .feedback-pulse[data-event-id="${event.id}"]`);
      await expect(card).toBeVisible(); await expect(card).toHaveText('+1 damage');
      for (const label of [board, card]) {
        const start = await animationSample(label, 0), middle = await animationSample(label, 1400), end = await animationSample(label, 2450);
        expect(start.duration).toBe(2800);
        expect(start.pointerEvents).toBe('none');
        expect(middle.y).toBeLessThan(start.y - 5);
        expect(end.y).toBeLessThan(middle.y - 4);
        expect(middle.opacity).toBeGreaterThan(.8);
        expect(end.opacity).toBeLessThan(.5);
        expect(end.opacity).toBeGreaterThan(0);
        const delay = end.delay;
        await wire.repeat();
        expect((await animationSample(label, 2450)).delay, 'Duplicate STATE must not alter the animation age').toBe(delay);
      }
      await page.clock.runFor(2300);
      await expect(board).toBeVisible(); await expect(card).toBeVisible();
      await page.clock.runFor(550); await silent(page);
      await wire.repeat(); await silent(page);
    });

    test('HEAL uses wounds actually removed, stays silent for a full-health cast, and never replays after undo/redo or reconnect', async ({ page }) => {
      const game = fixture(2); wound(game, 'p1', { p2: 1 });
      prepare(game, 'Mending Light'); prepare(game, 'Mending Light', 'slot1');
      const wire = await mount(page, game);
      await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid' });
      const healed = ofKind(wire.state, 'HEAL'); expect(healed).toHaveLength(1);
      expect(healed[0]).toMatchObject({ amount: 1, sourceId: 'p1', target: { kind: 'MAGE', id: 'p1' } });
      await pulseText(page, healed[0]);
      await expect(roster(page, 'p1').getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
      expect(mage(wire.state, 'p2').cubes.available).toBe(25);
      await wire.dispatch({ type: 'UNDO_ACTION', playerId: 'p1' }); await silent(page);
      await wire.dispatch({ type: 'REDO_ACTION', playerId: 'p1' }); await silent(page);
      expect(ofKind(wire.state, 'HEAL')).toEqual(healed);
      await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1' });
      expect(ofKind(wire.state, 'HEAL')).toEqual(healed); await silent(page);
      await page.clock.runFor(5000); await silent(page);
      // A new client instance baselines the same public HEAL UUID as history.
      await page.reload();
      await page.getByRole('button', { name: 'Create room', exact: true }).click();
      await expect(page.locator('.app')).toBeVisible(); await settle(page);
      const overlay = page.locator('.phase-overlay'); if (await overlay.isVisible()) await overlay.click();
      await silent(page); await wire.repeat(); await silent(page);
    });

    test('actual evocation healing appears on its board marker and card, never unrelated retinues', async ({ page }) => {
      const game = fixture(3), model = servant(game), untouched = servant(game, 'untouched-cadaver'); untouched.number = 2;
      wound(game, model.id, { p3: 1 }); prepare(game, "Summoner's Balm");
      const wire = await mount(page, game);
      await viewRetinue(page, 'p2');
      await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetEvocationId: model.id });
      const healed = ofKind(wire.state, 'HEAL'); expect(healed).toHaveLength(1);
      expect(healed[0]).toMatchObject({ amount: 1, target: { kind: 'EVOCATION', id: model.id } });
      await pulseText(page, healed[0]);
      const card = page.locator(`.evocation-card[data-evocation-id="${model.id}"]`);
      await expect(card.locator('.heal-pulse')).toHaveText('+1 healed');
      await expect(card.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
      await expect(page.locator(`.evocation-card[data-evocation-id="${untouched.id}"] .evocation-feedback-layer`)).toHaveCount(0);
      await expect(page.locator('.board .feedback-pulse')).toHaveCount(1);
      await expect(page.locator('.combat-popup')).toHaveCount(0);
      await page.clock.runFor(2400); await expect(card.locator('.heal-pulse')).toBeVisible();
      await page.clock.runFor(450); await silent(page);
    });

    test('concurrent convert, damage and heal balloons have separate SVG/card lanes without intercepting clicks', async ({ page }) => {
      let game = fixture(3); const model = servant(game); model.health = 4;
      wound(game, model.id, { p3: 1 });
      game = arm(game, "Servant's Safeguard", 'p2', { targetEvocationId: model.id });
      turn(game); prepare(game, 'Transmuting Surge', 'slot1');
      const wire = await mount(page, game);
      await viewRetinue(page, 'p2');
      const bounds = await hexBounds(hex(page));
      await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetEvocationId: model.id });
      const effects = events(wire.state).filter((event): event is Event<'DAMAGE'> | Event<'CONVERT'> | Event<'HEAL'> => event.kind === 'DAMAGE' || event.kind === 'CONVERT' || event.kind === 'HEAL');
      expect(effects.map(event => [event.kind, event.amount])).toEqual([['CONVERT', 1], ['DAMAGE', 1], ['HEAL', 2]]);
      for (const event of effects) await pulseText(page, event);
      const board = page.locator(`.board .feedback-pulse[data-target-id="${model.id}"]`);
      const card = page.locator(`.evocation-card[data-evocation-id="${model.id}"] .feedback-pulse`);
      await expect(board).toHaveCount(3); await expect(card).toHaveCount(3);
      expect(await board.evaluateAll(labels => labels.map(label => label.getAttribute('data-stack-slot')))).toEqual(['0', '1', '2']);
      await separated(board); await separated(card);
      const balloon = page.locator('.board .feedback-interrupt');
      await expect(balloon).toHaveCount(1); await expect(balloon).toHaveAttribute('data-target-id', model.id);
      await svgOverlay(page);
      expect(await hexBounds(hex(page))).toEqual(bounds);
      for (const layer of [board, card, balloon]) expect(await layer.evaluateAll(nodes => nodes.every(node =>
        [node, ...node.querySelectorAll('*')].every(element => getComputedStyle(element).pointerEvents === 'none')))).toBe(true);
      await unobscured(hex(page)); await hex(page).click();
      await expect(page.locator('.room-detail')).toContainText('Rose Sanctum');
      await svgOverlay(page);
      await unobscured(page.getByRole('tab', { name: 'Physical actions', exact: true }));
      await dismiss(page, 'Protection triggered');
      await page.clock.runFor(5000); await silent(page);
      await expect(page.locator('.evocation-feedback-layer')).toHaveCount(0);
    });

    test('interrupt reveal progressively displays actual correlated outcomes without delaying actions or moving focus', async ({ page }) => {
      let game = fixture(2); game = arm(game, 'Thorn Retort', 'p2', {}); turn(game);
      const wire = await mount(page, game);
      await selectControlTab(page, 'Physical actions');
      const tab = page.getByRole('tab', { name: 'Physical actions', exact: true });
      await tab.focus(); await expect(tab).toBeFocused();
      await wire.dispatch({ type: 'PUNCH', playerId: 'p1', targetId: 'p2' });
      const trigger = ofKind(wire.state, 'SPELL_TRIGGERED')[0];
      expect(mage(wire.state, 'p2').wizard.damageCubes).toBe(1);
      expect(mage(wire.state, 'p1').wizard.damageCubes).toBe(1);
      expect(wire.state.activation?.actionsUsed).toBe(1);
      await expect(tab).toBeFocused();
      const lines = popup(page, 'Protection triggered').locator('.interrupt-effect-line');
      const balloon = page.locator(`.board .feedback-interrupt[data-interrupt-id="${trigger.id}"]`);
      await expect(lines).toHaveCount(0); await expect(balloon.locator('.interrupt-balloon-effect')).toHaveCount(0);
      await page.clock.runFor(500);
      await expect(lines).toHaveText(['Blue Seer: 1 wound healed.']);
      await expect(balloon).toHaveAttribute('aria-label', /Blue Seer: 1 wound healed/);
      await expect(balloon).not.toHaveAttribute('aria-label', /Rose Warden: 1 damage/);
      // The remaining physical action starts while the second recap line is
      // still pending. No server command or UI control waits for the animation.
      await wire.dispatch({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
      expect(wire.state.activation?.physicalAction?.kind).toBe('EXPLORE');
      await expect(lines).toHaveCount(1); await expect(tab).toBeFocused();
      await page.clock.runFor(550);
      await expect(lines).toHaveText(['Blue Seer: 1 wound healed.', 'Rose Warden: 1 damage.']);
      await expect(balloon).toHaveAttribute('aria-label', /Rose Warden: 1 damage/);
      await svgOverlay(page);
      // Leaving the hit room moves Rose Warden's result to its room fallback
      // and reflows Blue Seer's marker. Existing portals must follow that new
      // model layout without restarting the surviving balloon's animation.
      const healed = ofKind(wire.state, 'HEAL')[0];
      const delay = (await animationSample(pulse(page, healed), 1200)).delay;
      await wire.dispatch({ type: 'PERFORM_MOVEMENT', playerId: 'p1' });
      await wire.dispatch({ type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 1, r: 0 } });
      const displaced = ofKind(wire.state, 'DAMAGE').find(event => event.target.id === 'p1')!;
      await expect(page.locator(`.board .feedback-svg-position[data-anchor-kind="ROOM"][data-anchor-id="${center}"]`)
        .locator(`.feedback-pulse[data-event-id="${displaced.id}"]`)).toHaveCount(1);
      await svgOverlay(page);
      expect((await animationSample(pulse(page, healed), 1200)).delay).toBe(delay);
      await unobscured(tab); await noOverflow(page);
      await dismiss(page, 'Protection triggered'); await page.clock.runFor(5000); await silent(page);
    });

    test('interrupt effects fall back only to revealed public summaries when no numeric outcome exists', async ({ page }) => {
      let game = fixture(2); mage(game).wizard.position = { q: 1, r: 0 }; room(game, east).effect = 'INSTABILITY';
      game = arm(game, 'Cinder Seal', 'p2', { roomId: east }); turn(game);
      const wire = await mount(page, game);
      await wire.dispatch({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
      await wire.dispatch({ type: 'ACTIVATE_ROOM', playerId: 'p1', roomTargetId: east });
      const trigger = ofKind(wire.state, 'SPELL_TRIGGERED')[0];
      expect(trigger.effects).toEqual(['Place up to 2 instability in the bound room.']);
      expect(events(wire.state).filter(event => event.interruptId === trigger.id)).toEqual([]);
      const lines = popup(page, 'Trap triggered').locator('.interrupt-effect-line');
      await expect(lines).toHaveCount(0);
      await expect(page.locator('.feedback-pulse')).toHaveCount(0);
      await expect(page.locator('.board .feedback-interrupt')).toHaveCount(1);
      await page.clock.runFor(500); await expect(lines).toHaveText(trigger.effects!);
      await expect(page.locator('.board .feedback-interrupt')).toHaveAttribute('aria-label', /Place up to 2 instability/);
      expect(room(wire.state, east).instability).toBeGreaterThanOrEqual(2);
      await dismiss(page, 'Trap triggered'); await page.clock.runFor(5000); await silent(page);
    });

    test('reduced motion disables feedback animation while static labels remain and controls are not covered', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      let game = fixture(3); game = arm(game, 'Threshold Snare', 'p1', { roomId: east });
      game = arm(game, 'Mending Ward', 'p2', { targetPlayerId: 'p2' });
      wound(game, 'p2', { p3: 1 }); prepare(game, 'Transmuting Surge', 'slot1'); turn(game);
      const wire = await mount(page, game); await expect(reminders(page)).toBeVisible();
      const bounds = await hexBounds(hex(page));
      await wire.dispatch({ type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
      const labels = [...ofKind(wire.state, 'CONVERT'), ...ofKind(wire.state, 'DAMAGE'), ...ofKind(wire.state, 'HEAL')];
      expect(labels.map(event => event.kind)).toEqual(['CONVERT', 'DAMAGE', 'HEAL']);
      for (const event of labels) {
        await pulseText(page, event);
        const animationNames = await pulse(page, event).evaluate(node => [node, ...node.querySelectorAll('*')]
          .map(element => getComputedStyle(element).animationName));
        expect(animationNames.every(name => name.split(',').every(value => value.trim() === 'none'))).toBe(true);
        expect(await pulse(page, event).locator('.feedback-motion').evaluate(node => ({ transform: getComputedStyle(node).transform,
          opacity: getComputedStyle(node).opacity }))).toEqual({ transform: 'none', opacity: '1' });
      }
      await expect(page.locator('.board .feedback-interrupt')).toHaveCount(1);
      expect(await page.locator('.board .feedback-interrupt').evaluate(node => [node, ...node.querySelectorAll('*')]
        .every(element => getComputedStyle(element).animationName === 'none'))).toBe(true);
      await svgOverlay(page);
      expect(await hexBounds(hex(page))).toEqual(bounds);
      await selectControlTab(page, 'Physical actions');
      await unobscured(page.getByRole('tab', { name: 'Physical actions', exact: true }));
      await unobscured(page.locator('.actions-panel').getByRole('button', { name: /^Explore/ }));
      await unobscured(hex(page)); await noOverflow(page);
      await dismiss(page, 'Protection triggered');
      await page.clock.runFor(5000); await silent(page);
    });
  });
}