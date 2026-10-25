import { test, expect, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { createGame, type Card, type Evocation, type GameAction, type GameState } from '../packages/game-engine/src/index';
import { ActionHistory } from '../apps/server/src/action-history';
import { publicState } from '../apps/server/src/public-state';
import { closeChronicle, openChronicle, selectControlTab } from './layout-ui';

type QuickPanel = 'Physical actions' | 'Spells' | 'Evocations' | 'Quests';
type Request = { action: GameAction; requestId: string };
type Reply = { action: GameAction; before: GameState; after: GameState };
const panels: QuickPanel[] = ['Physical actions', 'Spells', 'Evocations', 'Quests'];
const labels = ['Open physical actions', 'Open spells', 'Open evocations', 'Open quests', 'Open Chronicle'];
const faults = new WeakMap<Page, string[]>();
const dock = (page: Page) => page.getByRole('navigation', { name: 'Quick access', exact: true });
const launcher = (page: Page, name: string) => page.getByRole('button', { name, exact: true, includeHidden: true });
const banner = (page: Page) => page.locator('.control-banner');
const drawer = (page: Page) => page.locator('dialog#chronicle-drawer');
const log = (page: Page) => drawer(page).locator('[role="log"]');
const hex = (page: Page, id = 'room-0,0') => page.locator(`.hex[data-room-id="${id}"]`);
const spell = (page: Page) => page.locator('#controls-panel-spells .prepared .spell').filter({
  has: page.locator('strong', { hasText: /^Arcane Bolt$/ }),
});
const activate = (page: Page) => page.locator('#retinue-p1').getByRole('button', { name: /^Activate Cadaver #1/ });
const scroll = (page: Page) => page.evaluate(() => ({ x: scrollX, y: scrollY }));
const mapPosition = (page: Page) => page.locator('.board-viewport').evaluate(element => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y };
});
async function expectMapPosition(page: Page, before: { x: number; y: number }) {
  const after = await mapPosition(page);
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  // State changes can wrap the live map heading by one line on mobile. The
  // actual map must stay nearby, not jump back to its off-screen controls.
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(40);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
test.afterEach(async ({ page }) => {
  expect(faults.get(page), 'No browser errors or rejected authoritative fixture actions').toEqual([]);
});

function take(game: GameState, name: string): Card {
  for (const deck of game.library) {
    const index = deck.cards.findIndex(card => card.name === name);
    if (index >= 0) return deck.cards.splice(index, 1)[0];
  }
  throw new Error(`Missing canonical quick-access card: ${name}`);
}
function servant(id: string, playerId: string, q: number): Evocation {
  return { id, playerId, number: 1, name: 'Cadaver', archetype: 'UNDEAD', movement: 2, attack: 2,
    health: 2, passive: 'WOUNDED_FURY', position: { q, r: 0 }, damageCubes: 0,
    damageByPlayer: {}, activated: false };
}
function fixture(actor = 'p1'): GameState {
  const game = createGame(2);
  game.gameId = 'quick-access'; game.round = 1; game.phase = 'ACTION';
  game.firstPlayerId = 'p1'; game.currentPlayerId = actor;
  game.activation = { playerId: actor, actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
    spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
  game.players.forEach((player, index) => {
    player.name = ['Rose Warden', 'Blue Seer'][index]; player.connected = player.ready = true;
    player.wizard.position = { q: index, r: 0 };
  });
  game.players[0].prepared.slot1 = { card: take(game, 'Arcane Bolt'), used: false };
  game.players[0].prepared.rapid = { card: take(game, 'Fracture'), used: false };
  game.players[1].prepared.slot1 = { card: take(game, 'Renewing Word'), used: false };
  game.players[0].quest = game.questDeck.shift()!;
  game.evocations = [servant('rose-cadaver', 'p1', 0), servant('blue-cadaver', 'p2', 1)];
  game.log = ['Quick access fixture: first event.', 'Quick access fixture: latest event.'];
  return game;
}
function physicalCards(game: GameState) {
  return [...game.library.flatMap(deck => [...deck.cards, ...deck.discard]), ...game.powerfulDeck, ...game.removedCards,
    ...[...game.readiedSpells ?? [], ...game.ongoingSpells ?? []].map(active => active.card),
    ...game.players.flatMap(player => [...player.hand, ...player.personalDeck, ...player.discard,
      ...Object.values(player.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])]
    .map(card => card.id).sort();
}

async function dismissOverlay(page: Page) {
  const overlay = page.locator('.phase-overlay');
  await expect(overlay).toBeVisible();
  await overlay.click();
  await expect(overlay).toBeHidden();
}

async function mount(page: Page, initial = fixture()) {
  let game = structuredClone(initial), socket: WebSocketRoute | undefined;
  let held = false;
  const requests: Request[] = [], replies: Reply[] = [], acknowledgements: string[] = [];
  const history = new ActionHistory(), cards = physicalCards(game);
  expect(cards).toHaveLength(120); expect(new Set(cards).size).toBe(120);
  const publish = () => {
    if (!socket) throw new Error('Quick-access socket is not connected');
    // Real server projection: never give the client hidden decks or peer preparations.
    socket.send(JSON.stringify({ type: 'STATE', state: publicState(game, 'p1', history) }));
  };
  const reduce = (action: GameAction): Reply => {
    const before = game, after = history.apply(before, action, action.playerId);
    expect(physicalCards(after)).toEqual(cards);
    game = after; return { action, before, after };
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
          expect(message.action.playerId).toBe('p1');
          replies.push(reduce(message.action)); publish();
          if (held) acknowledgements.push(message.requestId);
          else route.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: message.requestId }));
        } catch (error) {
          faults.get(page)!.push(`Engine rejected ${JSON.stringify(message.action)}: ${String(error)}`);
          route.send(JSON.stringify({ type: 'ERROR', requestId: message.requestId, message: String(error) }));
        }
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.locator('.app')).toBeVisible(); await dismissOverlay(page);
  return { requests, replies, history, get state() { return game; },
    dispatch(action: GameAction) { const reply = reduce(action); publish(); return reply; },
    replace(state: GameState) {
      expect(physicalCards(state)).toEqual(cards);
      history.clear(); game = structuredClone(state); publish();
    },
    holdAcknowledgements() { held = true; },
    wrongAcknowledgement() { socket!.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId: 'unrelated-request' })); },
    releaseAcknowledgements() {
      held = false;
      for (const requestId of acknowledgements.splice(0)) socket!.send(JSON.stringify({ type: 'ACTION_APPLIED', requestId }));
    },
    close() { socket!.close({ code: 1000, reason: 'Quick-access offline fixture' }); },
  };
}
type Wire = Awaited<ReturnType<typeof mount>>;
async function command(page: Page, wire: Wire, click: () => Promise<unknown>, action: GameAction) {
  const index = wire.replies.length;
  await click(); await expect.poll(() => wire.replies.length).toBe(index + 1);
  expect(wire.replies[index].action).toEqual(action);
  await expect(page.getByRole('alert')).toHaveCount(0);
  return wire.replies[index];
}

// Do not scroll a launcher into view: doing so would hide a broken fixed dock.
async function hitCenter(control: Locator, touch = false) {
  await expect(control).toBeVisible();
  const box = await control.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight, hit: !!hit && (hit === element || element.contains(hit)) };
  });
  expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(box.viewportWidth + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(box.viewportHeight + 1);
  expect(box.hit, 'The center is actually clickable, not covered by the dock or another overlay').toBe(true);
  if (touch) { expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); }
  return box;
}
async function clickCenter(page: Page, control: Locator) {
  const box = await hitCenter(control);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function expectDock(page: Page) {
  const nav = dock(page);
  await expect(nav).toBeVisible(); await expect(nav.getByRole('button')).toHaveCount(5);
  await expect(nav.getByRole('tab')).toHaveCount(0); await expect(nav.getByRole('tablist')).toHaveCount(0);
  for (const label of labels) {
    const button = nav.getByRole('button', { name: label, exact: true });
    expect(await button.evaluate(element => element.tagName)).toBe('BUTTON');
    await expect(button).toHaveAttribute('aria-label', label);
    await hitCenter(button, page.viewportSize()!.width <= 390);
  }
  const geometry = await nav.evaluate(element => {
    const nodes: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) nodes.push(node);
    // Chromium's safe-area env() is zero without a device cutout. Check the
    // matching CSS as well as viewport geometry rather than asserting zero padding.
    const rules = (list: CSSRuleList): CSSStyleRule[] => Array.from(list).flatMap(rule =>
      rule instanceof CSSStyleRule ? [rule] : 'cssRules' in rule ? rules((rule as CSSGroupingRule).cssRules) : []);
    const safeArea = Array.from(document.styleSheets).flatMap(sheet => {
      try { return rules(sheet.cssRules); } catch { return []; }
    }).some(rule => /safe-area-inset-bottom/.test(rule.style.cssText) && nodes.some(node => {
      try { return node.matches(rule.selectorText); } catch { return false; }
    }));
    const bounds = element.getBoundingClientRect();
    return { fixed: nodes.some(node => getComputedStyle(node).position === 'fixed'),
      bottom: bounds.bottom, viewport: innerHeight, safeArea };
  });
  expect(geometry.fixed).toBe(true); expect(geometry.safeArea, 'The dock accounts for the bottom safe area').toBe(true);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.bottom).toBeGreaterThanOrEqual(geometry.viewport - 32);
}
async function openQuick(page: Page, name: QuickPanel) {
  const label = `Open ${name === 'Physical actions' ? 'physical actions' : name.toLowerCase()}`;
  await clickCenter(page, launcher(page, label));
  await expect(banner(page)).toHaveClass(/is-floating/);
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
  await expect(banner(page).locator('.control-banner-heading').getByRole('button', { name: 'Back to map', exact: true })).toBeVisible();
  await expect(banner(page)).toHaveCSS('position', 'fixed');
}
async function backToMap(page: Page, name: QuickPanel) {
  await banner(page).getByRole('button', { name: 'Back to map', exact: true }).click();
  await expect(banner(page)).not.toHaveClass(/is-floating/);
  await expect(launcher(page, `Open ${name === 'Physical actions' ? 'physical actions' : name.toLowerCase()}`)).toBeFocused();
}
async function expectLog(page: Page, game: GameState) {
  await expect(log(page).locator(':scope > div')).toHaveText(game.log.slice(-45).reverse().map(entry => `✧${entry}`));
}
async function expectChronicleClosed(page: Page) {
  await expect(drawer(page)).toBeHidden();
  await expect(drawer(page)).not.toHaveAttribute('open');
  await expect(launcher(page, 'Open Chronicle')).toHaveAttribute('aria-expanded', 'false');
  await expect(launcher(page, 'Open Chronicle')).toBeFocused();
}
async function backdropPoint(page: Page) {
  return drawer(page).evaluate(element => {
    for (const x of [2, 8, innerWidth - 2]) for (const y of [innerHeight / 2, innerHeight / 4, innerHeight * .75]) {
      if (document.elementFromPoint(x, y) === element) return { x, y };
    }
    throw new Error('The right drawer needs a clickable backdrop outside its content');
  });
}
async function positionMap(page: Page, id = 'room-1,0') {
  const tile = hex(page, id);
  await tile.scrollIntoViewIfNeeded();
  await tile.evaluate(element => {
    const rect = element.getBoundingClientRect();
    window.scrollBy(0, rect.y + rect.height / 2 - innerHeight * .4);
  });
  await hitCenter(tile);
}
async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`persistent quick access at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });

    test('Chronicle is a mounted, default-closed modal drawer with a single-column map, live latest-first log and restored focus/scroll', async ({ page }) => {
      const initial = fixture('p2');
      initial.log = Array.from({ length: 48 }, (_, i) => `Chronicle seed ${i + 1}`);
      const wire = await mount(page, initial);
      await expect(drawer(page)).toHaveCount(1); await expect(drawer(page)).toBeHidden();
      await expect(launcher(page, 'Open Chronicle')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('log')).toHaveCount(0);
      await expect(page.getByRole('log', { includeHidden: true })).toHaveCount(1);
      await expect(page.locator('aside .log-panel')).toHaveCount(0);
      await expect(page.locator('.log-panel')).toHaveCount(1); await expectLog(page, wire.state);
      const mountedLog = await log(page).elementHandle();
      const layout = await page.locator('main').evaluate(main => {
        const style = getComputedStyle(main), map = document.querySelector('.board-panel')!.getBoundingClientRect();
        return { columns: style.display === 'grid' ? style.gridTemplateColumns.split(/\s+/).length : 1,
          mapWidth: map.width, contentWidth: main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(layout.columns).toBe(1); expect(layout.overflow).toBe(false);
      expect(layout.mapWidth).toBeGreaterThan(layout.contentWidth * .95);
      await selectControlTab(page, 'Quests');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
      const before = await scroll(page);
      const bodyStyle = await page.locator('body').evaluate(body => ({ overflow: body.style.overflow, position: body.style.position }));
      const modal = await openChronicle(page);
      // Native showModal() makes everything outside the dialog inert, including
      // the persistent dock. Its buttons are intentionally not role-visible here.
      const drawerBounds = await modal.boundingBox();
      expect(drawerBounds!.x).toBeGreaterThanOrEqual(0); expect(drawerBounds!.y).toBeGreaterThanOrEqual(0);
      expect(drawerBounds!.x + drawerBounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(drawerBounds!.x + drawerBounds!.width).toBeGreaterThanOrEqual(viewport.width - 32);
      expect(drawerBounds!.y + drawerBounds!.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(await modal.evaluate(element => element.contains(document.activeElement))).toBe(true);
      expect(await page.locator('body').evaluate(body => ['hidden', 'clip'].includes(getComputedStyle(body).overflowY) ||
        getComputedStyle(body).position === 'fixed'), 'Opening Chronicle locks body scroll').toBe(true);
      for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        expect(await modal.evaluate(element => element.contains(document.activeElement)), 'Focus cannot escape the modal').toBe(true);
      }
      wire.dispatch({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p2', kind: 'EXPLORE' });
      await expectLog(page, wire.state); await expect(modal.getByRole('log')).toContainText('Blue Seer begins EXPLORE');
      await page.screenshot({ path: test.info().outputPath('chronicle-drawer.png'), animations: 'disabled' });
      const backdrop = await backdropPoint(page);
      // Start at the page bottom and wheel UP; wheeling down could pass even
      // without a lock simply because the underlying document was already full.
      await page.mouse.move(backdrop.x, backdrop.y); await page.mouse.wheel(0, -500); await frame(page);
      await closeChronicle(page);
      await expectChronicleClosed(page); expect(await scroll(page)).toEqual(before);
      expect(await page.locator('body').evaluate(body => ({ overflow: body.style.overflow, position: body.style.position }))).toEqual(bodyStyle);
      await expect(page.getByRole('tab', { name: 'Quests', exact: true })).toHaveAttribute('aria-selected', 'true');
      const closedLogLength = wire.state.log.length;
      wire.dispatch({ type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p2' });
      wire.dispatch({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p2', kind: 'ATTACK' });
      expect(wire.state.log.length).toBeGreaterThan(closedLogLength);
      await expectLog(page, wire.state); await expect(log(page)).toBeHidden();
      await expect(log(page)).toContainText('Blue Seer begins ATTACK');
      await openChronicle(page); await expectLog(page, wire.state);
      await page.keyboard.press('Escape'); await expectChronicleClosed(page);
      expect(await scroll(page)).toEqual(before);
      await openChronicle(page);
      const point = await backdropPoint(page); await page.mouse.click(point.x, point.y);
      await expectChronicleClosed(page); expect(await scroll(page)).toEqual(before);
      expect(await mountedLog!.evaluate(element => element === document.querySelector('#chronicle-drawer [role="log"]'))).toBe(true);
      expect(wire.requests).toEqual([]); // Browsing Chronicle never sends a game action.
    });

    test('Chronicle glows each mage name in that mage color without changing the entry text', async ({ page }) => {
      const initial = fixture('p2');
      initial.log = ['Rose Warden attacks Blue Seer', 'Rose Warden discards a card', 'Cadaver moves, Blue Seerer ignored'];
      const wire = await mount(page, initial);
      wire.dispatch({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p2', kind: 'EXPLORE' });
      const modal = await openChronicle(page);
      await expectLog(page, wire.state);
      const entry = log(page).locator('.log-text').filter({ hasText: 'Blue Seer begins EXPLORE' });
      await expect(entry.locator('.log-mage')).toHaveText(['Blue Seer']);
      const glow = (locator: Locator) => locator.evaluate(element => {
        const style = getComputedStyle(element);
        return { color: style.color, shadow: style.textShadow };
      });
      const blue = await glow(entry.locator('.log-mage'));
      expect(blue.color).toBe('rgb(96, 165, 250)'); expect(blue.shadow).not.toBe('none'); expect(blue.shadow).toContain('rgb(96, 165, 250)');
      const rose = log(page).locator('.log-text').filter({ hasText: 'Rose Warden attacks Blue Seer' }).locator('.log-mage');
      await expect(rose).toHaveText(['Rose Warden', 'Blue Seer']);
      expect((await glow(rose.first())).color).toBe('rgb(251, 113, 133)');
      expect((await glow(rose.nth(1))).color).toBe('rgb(96, 165, 250)');
      // Only whole names glow; unrelated words keep the normal log color.
      await expect(log(page).locator('.log-text').filter({ hasText: 'Blue Seerer ignored' }).locator('.log-mage')).toHaveCount(0);
      await expect(modal.getByRole('log')).toContainText('Rose Warden attacks Blue Seer');
      await page.screenshot({ path: test.info().outputPath('chronicle-glow.png'), animations: 'disabled' });
    });

    test('the dock is the only way to the one mounted controls dashboard, which opens without scrolling, duplicating tabs or remounting', async ({ page }) => {
      const wire = await mount(page);
      await expect(banner(page)).not.toHaveClass(/is-floating/);
      await expect(banner(page)).toBeHidden(); await expect(page.locator('.control-banner-slot')).toBeHidden();
      await expect(page.getByRole('tablist')).toBeHidden();
      const original = await banner(page).elementHandle(), originalSpell = await spell(page).elementHandle();
      const snapshot = structuredClone(wire.state);
      for (const name of panels) {
        await positionMap(page);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
        const before = await scroll(page);
        const flow = () => page.locator('.board-panel, .players-panel').evaluateAll(elements => elements.map(element => {
          const box = element.getBoundingClientRect();
          return { top: box.top + scrollY, left: box.left + scrollX, width: box.width, height: box.height };
        }));
        const anchors = await flow();
        await expectDock(page);
        await openQuick(page, name); expect(await scroll(page)).toEqual(before);
        expect(await flow(), 'The floating dashboard never changes the page flow').toEqual(anchors);
        await expect(page.locator('.control-banner')).toHaveCount(1);
        await expect(page.locator('.actions-panel')).toHaveCount(1);
        await expect(page.locator('#retinue-p1')).toHaveCount(1);
        await expect(page.locator('.prepared')).toHaveCount(1);
        for (const id of ['actions', 'spells', 'evocations', 'quests']) {
          await expect(page.locator(`#controls-tab-${id}`)).toHaveCount(1);
          await expect(page.locator(`#controls-panel-${id}`)).toHaveCount(1);
          await expect(page.locator(`#controls-tab-${id}`)).toHaveAttribute('aria-controls', `controls-panel-${id}`);
          await expect(page.locator(`#controls-panel-${id}`)).toHaveAttribute('aria-labelledby', `controls-tab-${id}`);
        }
        expect(await original!.evaluate(element => element === document.querySelector('.control-banner'))).toBe(true);
        expect(await originalSpell!.evaluate(element => element === document.querySelector('#controls-panel-spells .prepared .spell'))).toBe(true);
        if (name === 'Physical actions') await page.screenshot({ path: test.info().outputPath('quick-actions.png'), animations: 'disabled' });
        await backToMap(page, name); expect(await scroll(page)).toEqual(before);
        expect(await flow()).toEqual(anchors);
        await expectDock(page);
        await openQuick(page, name);
        await page.getByRole('tab', { name, exact: true }).focus();
        await page.keyboard.press('Escape');
        await expect(banner(page)).toBeHidden();
        await expect(launcher(page, `Open ${name === 'Physical actions' ? 'physical actions' : name.toLowerCase()}`)).toBeFocused();
        expect(await scroll(page)).toEqual(before);
      }
      expect(wire.state).toEqual(snapshot); expect(wire.requests).toEqual([]);
    });

    test('quick Explore and Perform movement reveal the real map and spend only one token and turn action', async ({ page }) => {
      const wire = await mount(page); await positionMap(page);
      const before = await mapPosition(page);
      await openQuick(page, 'Physical actions');
      await command(page, wire, () => banner(page).getByRole('button', { name: /^Explore/ }).click(),
        { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
      await expect(banner(page)).toHaveClass(/is-floating/);
      expect(wire.state.players[0].actionTokens).toBe(1);
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, physicalAction: { kind: 'EXPLORE', movementStarted: false } });
      await command(page, wire, () => banner(page).getByRole('button', { name: /^Perform 2 movements/ }).click(),
        { type: 'PERFORM_MOVEMENT', playerId: 'p1' });
      await expect(banner(page)).not.toHaveClass(/is-floating/); await expectMapPosition(page, before);
      await expect(hex(page, 'room-1,0')).toHaveClass(/reachable/);
      await command(page, wire, () => clickCenter(page, hex(page, 'room-1,0')),
        { type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 1, r: 0 } });
      await expect(hex(page, 'room-1,0').locator('[data-mage-id="p1"]')).toHaveCount(1);
      expect(wire.state.activation!.exploring).toBe(1);
      await command(page, wire, () => hex(page).click(),
        { type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 0, r: 0 } });
      await openQuick(page, 'Physical actions');
      await expect(banner(page).locator('.physical-effects')).toHaveAttribute('data-physical-kind', 'EXPLORE');
      await command(page, wire, () => banner(page).getByRole('button', { name: 'Skip remaining effects', exact: true }).click(),
        { type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
      await backToMap(page, 'Physical actions');
      expect(wire.state.players[0].wizard.position).toEqual({ q: 0, r: 0 });
      expect(wire.state.players[0].actionTokens).toBe(1);
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, exploring: 0, physicalAction: null });
      expect(wire.requests.map(request => request.action.type)).toEqual([
        'BEGIN_PHYSICAL_ACTION', 'PERFORM_MOVEMENT', 'EXPLORE_STEP', 'EXPLORE_STEP', 'SKIP_PHYSICAL_EFFECTS',
      ]);
    });

    test('quick spell selection closes controls for map targeting and fixes model confirmation above the dock without a page-scroll jump', async ({ page }) => {
      const wire = await mount(page); await positionMap(page);
      const before = await mapPosition(page);
      await openQuick(page, 'Spells');
      await spell(page).click();
      await expect(banner(page)).not.toHaveClass(/is-floating/);
      await expect(spell(page)).toHaveClass(/chosen/); await expectMapPosition(page, before);
      await expect(hex(page, 'room-1,0')).toHaveClass(/reachable/);
      await clickCenter(page, hex(page, 'room-1,0'));
      const confirmation = page.locator('.room-detail.quick-target');
      await expect(confirmation).toBeVisible(); await expect(confirmation).toHaveCSS('position', 'fixed');
      const target = confirmation.getByRole('combobox', { name: 'Spell target model', exact: true });
      await expect(target.locator('option')).toHaveText(['First eligible model in this room', 'Blue Seer', 'Cadaver #1 (Blue Seer)']);
      await hitCenter(target, viewport.width <= 390); await target.selectOption('p2');
      const cast = confirmation.getByRole('button', { name: 'Cast Arcane Bolt here', exact: true });
      await expect(cast).toBeEnabled(); await hitCenter(cast, viewport.width <= 390);
      const bounds = await confirmation.boundingBox(), dockBounds = await dock(page).boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(dockBounds!.y + 1);
      await expectMapPosition(page, before); expect(wire.requests).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('quick-spell-target.png'), animations: 'disabled' });
      await command(page, wire, () => clickCenter(page, cast),
        { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
      expect(wire.state.players[1].wizard).toMatchObject({ damageCubes: 3, damageByPlayer: { p1: 3 } });
      expect(wire.state.players[0].cubes.onWizard).toBe(3);
      expect(wire.state.players[0].actionTokens).toBe(2);
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: true });
      expect(wire.state.players[0].prepared.slot1!.used).toBe(true);
      await expect(page.locator('.room-detail').getByRole('button', { name: /^Cast / })).toHaveCount(0);
      await expectMapPosition(page, before);
      await openQuick(page, 'Spells'); await expect(spell(page)).toBeDisabled(); await expect(spell(page)).toHaveClass(/used/);
      await backToMap(page, 'Spells');
    });

    test('paid evocation activation closes quick controls, enables board movement and retains its authoritative cost on reopening', async ({ page }) => {
      const wire = await mount(page); await positionMap(page);
      const before = await mapPosition(page);
      await openQuick(page, 'Evocations');
      await command(page, wire, () => activate(page).click(),
        { type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: 'rose-cadaver' });
      await expect(banner(page)).not.toHaveClass(/is-floating/); await expectMapPosition(page, before);
      expect(wire.state.evocationActivation).toEqual({ playerId: 'p1', evocationId: 'rose-cadaver', movesRemaining: 2, returnToAction: true });
      expect(wire.state.players[0].actionTokens).toBe(1); expect(wire.state.activation!.actionsUsed).toBe(1);
      await expect(hex(page, 'room-1,0')).toHaveClass(/reachable/);
      await command(page, wire, () => clickCenter(page, hex(page, 'room-1,0')),
        { type: 'EVOCATION_STEP', playerId: 'p1', destination: { q: 1, r: 0 } });
      await expect(hex(page, 'room-1,0').locator('[data-evocation-id="rose-cadaver"]')).toHaveCount(1);
      await openQuick(page, 'Evocations');
      await expect(banner(page).locator('.evocation-controls')).toContainText('1 movement remaining.');
      await expect(activate(page)).toBeDisabled();
      await command(page, wire, () => banner(page).getByRole('button', { name: 'Finish evocation', exact: true }).click(),
        { type: 'END_EVOCATION', playerId: 'p1' });
      await expect(page.getByRole('tab', { name: 'Physical actions', exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(wire.state.evocationActivation).toBeNull();
      expect(wire.state.players[0].actionTokens).toBe(1); expect(wire.state.activation!.actionsUsed).toBe(1);
    });

    test('physical attack menus offer only real enemies, clear spell dummy mode and keep no-target skips separate', async ({ page }) => {
      const initial = fixture();
      initial.players[1].wizard.position = { q: 0, r: 0 };
      initial.evocations[1].position = { q: 0, r: 0 };
      const wire = await mount(page, initial);
      await selectControlTab(page, 'Spells'); await spell(page).click();
      await page.getByRole('button', { name: 'Target dummy · no damage', exact: true }).click();
      await selectControlTab(page, 'Physical actions');
      await command(page, wire, () => banner(page).getByRole('button', { name: /^Attack\b/ }).click(),
        { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' });
      await expect(page.getByRole('button', { name: /Target dummy/, includeHidden: true })).toHaveCount(0);
      await banner(page).getByRole('button', { name: /^Inflict 2 damage to a model/ }).click();
      const targets = page.getByRole('group', { name: 'Attack target', exact: true });
      await expect(targets.getByRole('button')).toHaveText([
        'Inflict 2 damage on Blue Seer', 'Inflict 2 damage on Cadaver #1 (Blue Seer)',
      ]);
      await command(page, wire, () => targets.getByRole('button', { name: 'Inflict 2 damage on Blue Seer', exact: true }).click(),
        { type: 'INFLICT_ATTACK', playerId: 'p1', targetId: 'p2' });
      expect(wire.state.players[1].wizard.damageByPlayer).toEqual({ p1: 2 });
      await command(page, wire, () => banner(page).getByRole('button', { name: 'Skip remaining effects', exact: true }).click(),
        { type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
      expect(wire.state.players[0].actionTokens).toBe(1);
      expect(wire.state.activation).toMatchObject({ actionsUsed: 1, physicalAction: null });

      // Empty-room attacks can be skipped, never redirected onto a dummy.
      const empty = fixture(); wire.replace(empty);
      await command(page, wire, () => banner(page).getByRole('button', { name: /^Attack\b/ }).click(),
        { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' });
      await expect(banner(page).getByRole('button', { name: /^Inflict 2 damage to a model/ })).toBeDisabled();
      await expect(banner(page).locator('.attack-targets')).toHaveCount(0);
      await expect(banner(page)).toContainText('No enemy model in this room.');
      await expect(page.getByRole('button', { name: /Target dummy/, includeHidden: true })).toHaveCount(0);
      await command(page, wire, () => banner(page).getByRole('button', { name: 'Skip remaining effects', exact: true }).click(),
        { type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
      expect(wire.state.players.map(player => player.wizard.damageCubes)).toEqual([0, 0]);

      // Only selecting a spell card brings back the dummy option.
      await selectControlTab(page, 'Spells'); await spell(page).click();
      await page.getByRole('button', { name: 'Target dummy · no damage', exact: true }).click();
      await hex(page).click();
      await command(page, wire, () => page.locator('.room-detail').getByRole('button', { name: 'Cast Arcane Bolt here on dummy', exact: true }).click(),
        { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', roomId: 'room-0,0', dummy: true });
      expect(wire.state.players[0].prepared.slot1!.used).toBe(true);
      expect(wire.state.players.map(player => player.wizard.damageCubes)).toEqual([0, 0]);
      expect(wire.state.players[0].actionTokens).toBe(1);
    });

    for (const phase of ['ACTION', 'EVOCATION'] as const) test(`${phase} evocation attacks offer only real enemies and finish normally without a target`, async ({ page }) => {
      const initial = fixture(); initial.phase = phase;
      if (phase === 'EVOCATION') initial.activation = null;
      initial.players[1].wizard.position = { q: 0, r: 0 };
      initial.evocations[1].position = { q: 0, r: 0 };
      const wire = await mount(page, initial);
      await selectControlTab(page, 'Evocations');
      await command(page, wire, () => activate(page).click(),
        { type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: 'rose-cadaver' });
      const controls = banner(page).locator('.evocation-controls');
      await selectControlTab(page, 'Evocations');
      await expect(controls.getByRole('button')).toHaveText([
        'Cadaver attack Blue Seer2 damage', 'Cadaver attack Cadaver #1 (Blue Seer)2 damage', 'Finish evocation',
      ]);
      await expect(controls.getByRole('button', { name: /dummy/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Target dummy/, includeHidden: true })).toHaveCount(0);
      await command(page, wire, () => controls.getByRole('button', { name: /^Cadaver attack Blue Seer/ }).click(),
        { type: 'EVOCATION_ATTACK', playerId: 'p1', targetId: 'p2' });
      expect(wire.state.players[1].wizard.damageByPlayer).toEqual({ p1: 2 });
      expect(wire.state.evocationActivation).toBeNull();
      expect(wire.state.players[0].actionTokens).toBe(phase === 'ACTION' ? 1 : 2);

      const empty = structuredClone(initial);
      empty.players[1].wizard.position = { q: 1, r: 0 };
      empty.evocations[1].position = { q: 1, r: 0 };
      wire.replace(empty); await selectControlTab(page, 'Evocations');
      await command(page, wire, () => activate(page).click(),
        { type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: 'rose-cadaver' });
      await selectControlTab(page, 'Evocations');
      await expect(controls.getByRole('button')).toHaveText(['Finish evocation']);
      await expect(controls).toContainText('No enemy models in this room.');
      await command(page, wire, () => controls.getByRole('button', { name: 'Finish evocation', exact: true }).click(),
        { type: 'END_EVOCATION', playerId: 'p1' });
      expect(wire.state.evocationActivation).toBeNull();
      expect(wire.state.players.map(player => player.wizard.damageCubes)).toEqual([0, 0]);
      expect(wire.state.evocations.map(model => model.damageCubes)).toEqual([0, 0]);
    });

    test('pending ACK, peer turn, disconnected peer and offline states cannot bypass existing command gates through quick access', async ({ page }) => {
      const initial = fixture(), wire = await mount(page, initial);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      wire.holdAcknowledgements(); await openQuick(page, 'Physical actions');
      await command(page, wire, () => banner(page).getByRole('button', { name: /^Explore/ }).click(),
        { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
      const movement = banner(page).getByRole('button', { name: /^Perform 2 movements/ });
      await expect(movement).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Undo action', exact: true })).toBeDisabled();
      await movement.dispatchEvent('click');
      await openQuick(page, 'Spells'); await expect(spell(page)).toBeDisabled(); await spell(page).dispatchEvent('click');
      await openQuick(page, 'Evocations'); await expect(activate(page)).toBeDisabled(); await activate(page).dispatchEvent('click');
      wire.wrongAcknowledgement(); await frame(page);
      await openQuick(page, 'Physical actions'); await expect(movement).toBeDisabled();
      expect(wire.requests).toHaveLength(1);
      wire.releaseAcknowledgements(); await expect(movement).toBeEnabled();
      await backToMap(page, 'Physical actions');

      const peerTurn = structuredClone(initial); peerTurn.currentPlayerId = 'p2'; peerTurn.activation!.playerId = 'p2';
      const disconnected = structuredClone(initial); disconnected.players[1].connected = false;
      for (const state of [peerTurn, disconnected]) {
        wire.replace(state); await openQuick(page, 'Physical actions');
        await expect(banner(page).locator('.actions-panel button:enabled')).toHaveCount(0);
        if (state === peerTurn) await expect(banner(page).locator('.control-waiting')).toContainText('Blue Seer is acting.');
        else await expect(page.getByText(/Game paused\. Waiting for the disconnected mage/)).toBeVisible();
        await openQuick(page, 'Spells'); await expect(spell(page)).toBeDisabled(); await spell(page).dispatchEvent('click');
        await openQuick(page, 'Evocations'); await expect(activate(page)).toBeDisabled(); await activate(page).dispatchEvent('click');
        await openQuick(page, 'Quests'); await expect(banner(page).locator('.quest-panel')).toBeVisible();
        await backToMap(page, 'Quests'); await openChronicle(page); await closeChronicle(page);
        expect(wire.requests).toHaveLength(1);
      }
      wire.replace(initial); await openQuick(page, 'Physical actions');
      await expect(banner(page).getByRole('button', { name: /^Explore/ })).toBeEnabled();
      wire.close(); await expect(page.locator('.header-meta')).toContainText('Offline');
      await expect(banner(page).locator('.actions-panel button:enabled')).toHaveCount(0);
      await openQuick(page, 'Spells'); await expect(spell(page)).toBeDisabled(); await spell(page).dispatchEvent('click');
      await openQuick(page, 'Evocations'); await expect(activate(page)).toBeDisabled(); await activate(page).dispatchEvent('click');
      await backToMap(page, 'Evocations'); await expectDock(page);
      await openChronicle(page); await expectLog(page, wire.state); await closeChronicle(page);
      await expect(page.getByRole('alert')).toContainText('Connection closed.');
      expect(wire.requests).toHaveLength(1);
    });

    test('closing/reopening preserves local physical choices and exact authoritative undo/redo snapshots', async ({ page }) => {
      const initial = fixture();
      const emerald = initial.board.rooms.find(room => room.effect === 'INSTABILITY')!;
      initial.players[0].wizard.position = { ...emerald.tiles[0] };
      const wire = await mount(page, initial);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await openQuick(page, 'Physical actions');
      await command(page, wire, () => banner(page).getByRole('button', { name: /^Explore/ }).click(),
        { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
      const target = banner(page).getByRole('combobox', { name: 'Emerald effect target', exact: true });
      const chosen = await target.locator('option').nth(1).getAttribute('value');
      expect(chosen).toBeTruthy(); await target.selectOption(chosen!);
      const original = await banner(page).locator('.physical-effects').elementHandle();
      const snapshot = structuredClone(wire.state), status = wire.history.status(wire.state, 'p1');
      await backToMap(page, 'Physical actions'); await openQuick(page, 'Quests'); await backToMap(page, 'Quests');
      await openChronicle(page); await expectLog(page, snapshot); await closeChronicle(page);
      await openQuick(page, 'Physical actions'); await expect(target).toHaveValue(chosen!);
      expect(await original!.evaluate(element => element === document.querySelector('.physical-effects'))).toBe(true);
      expect(wire.state).toEqual(snapshot); expect(wire.history.status(wire.state, 'p1')).toEqual(status);
      expect(wire.requests).toHaveLength(1);
      await command(page, wire, () => page.getByRole('button', { name: 'Undo action', exact: true }).click(),
        { type: 'UNDO_ACTION', playerId: 'p1' });
      expect(wire.state).toEqual(initial);
      await backToMap(page, 'Physical actions'); await openQuick(page, 'Physical actions');
      await expect(banner(page).locator('.physical-effects')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Redo action', exact: true })).toBeEnabled();
      await command(page, wire, () => page.getByRole('button', { name: 'Redo action', exact: true }).click(),
        { type: 'REDO_ACTION', playerId: 'p1' });
      expect(wire.state).toEqual(snapshot);
      await backToMap(page, 'Physical actions'); await openQuick(page, 'Physical actions');
      await expect(banner(page).locator('.physical-effects')).toHaveAttribute('data-physical-kind', 'EXPLORE');
      await expect(target).toHaveValue(''); // Undo/redo intentionally resets transient choices.
      expect(wire.state.players[0].actionTokens).toBe(1); expect(wire.state.activation!.actionsUsed).toBe(1);
    });

    test('all in-game phase broadcasts retain the dock and allow Chronicle without resetting the selected dashboard tab', async ({ page }) => {
      const initial = fixture(), wire = await mount(page, initial);
      for (const phase of ['BLACK_ROSE', 'STUDY', 'PREPARATION', 'ACTION', 'EVOCATION', 'CLEANUP', 'GAME_OVER'] as const) {
        // Phase presentation fixtures only; actual quick commands in the other
        // cases always pass through ActionHistory/applyAction on private state.
        const next = structuredClone(initial); next.phase = phase;
        if (phase !== 'ACTION') next.activation = null;
        next.currentPlayerId = phase === 'ACTION' || phase === 'EVOCATION' ? 'p1' : null;
        if (phase === 'GAME_OVER') { next.winner = 'p1'; next.endgameScored = true; }
        wire.replace(next); await dismissOverlay(page);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expectDock(page); await openQuick(page, 'Quests'); await backToMap(page, 'Quests');
        await openChronicle(page); await expectLog(page, wire.state); await closeChronicle(page);
        await expect(page.getByRole('tab', { name: 'Quests', exact: true, includeHidden: true })).toHaveAttribute('aria-selected', 'true');
        await expect(banner(page)).not.toHaveClass(/is-floating/);
      }
      expect(wire.requests).toEqual([]);
    });
  });
}

test.describe('short mobile quick access', () => {
  test.use({ viewport: { width: 390, height: 568 }, reducedMotion: 'reduce' });
  test('the dock, Back to map, spell confirmation and Chronicle close button remain reachable', async ({ page }) => {
    const wire = await mount(page); await positionMap(page);
    const before = await mapPosition(page); await expectDock(page);
    await openQuick(page, 'Spells'); await hitCenter(banner(page).getByRole('button', { name: 'Back to map', exact: true }), true);
    await spell(page).click(); await expect(banner(page)).not.toHaveClass(/is-floating/);
    await expectMapPosition(page, before);
    await clickCenter(page, hex(page, 'room-1,0'));
    const confirmation = page.locator('.room-detail.quick-target');
    await hitCenter(confirmation.getByRole('combobox', { name: 'Spell target model', exact: true }), true);
    await hitCenter(confirmation.getByRole('button', { name: 'Cast Arcane Bolt here', exact: true }), true);
    await openChronicle(page);
    await hitCenter(drawer(page).getByRole('button', { name: 'Close Chronicle', exact: true }), true);
    await closeChronicle(page); await expectMapPosition(page, before);
    await expectDock(page); expect(wire.requests).toEqual([]);
  });
});