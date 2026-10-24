import { test, expect, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { createGame, getSpellType, type Card, type GameState, type SpellType } from '../packages/game-engine/src/index';
import { expectSchoolIcon, expectSpellIcon, expectSpellType } from './spell-ui';
import { selectSpells } from './layout-ui';

// Independent presentation expectations: do not import the client map under test.
const schools = {
  cantrip: { id: 'cantrip', label: 'Cantrip school', glyph: '✺' },
  transmutation: { id: 'transmutation', label: 'Transmutation school', glyph: '⚗' },
  enchantment: { id: 'enchantment', label: 'Enchantment school', glyph: '⌘' },
} as const;
const typeLabels: Record<SpellType, string> = {
  COMBAT: 'Combat', CONTINGENCY: 'Contingency', TRAP: 'Trap', PROTECTION: 'Protection',
};
type SchoolIcon = { id: string; label: string; glyph: string };

function fixture(): GameState {
  const game = createGame(2);
  // Later-round presentation snapshots, not a replacement for real setup flow.
  game.gameId = 'card-icons'; game.round = 2; game.phase = 'STUDY';
  game.currentPlayerId = null; game.activation = null;
  game.players.forEach((player, index) => {
    player.name = ['Icon Warden', 'Icon Seer'][index];
    player.connected = true; player.ready = true;
    player.startingSchoolId = 'cantrip';
    player.wizard.position = { q: index, r: 0 };
  });
  return game;
}

function take(game: GameState, name: string): Card {
  const deck = game.library.find(school => school.cards.some(card => card.name === name));
  expect(deck, `Canonical school card ${name} must exist in the finite library`).toBeDefined();
  return deck!.cards.splice(deck!.cards.findIndex(card => card.name === name), 1)[0];
}

function physicalIds(game: GameState): string[] {
  return [...game.library.flatMap(deck => [...deck.cards, ...deck.discard]),
    ...game.powerfulDeck, ...game.removedCards,
    ...[...game.readiedSpells ?? [], ...game.ongoingSpells ?? []].map(active => active.card),
    ...game.players.flatMap(player => [...player.hand, ...player.personalDeck, ...player.discard,
      ...Object.values(player.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])]
    .map(card => card.id).sort();
}

async function dismissOverlay(page: Page) {
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
}

async function mount(page: Page, game: GameState) {
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket('**', route => {
    socket = route;
    route.onMessage(data => {
      if (JSON.parse(String(data)).type === 'CREATE_ROOM') {
        route.send(JSON.stringify({ type: 'WELCOME', playerId: 'p1', roomId: 'card-icons' }));
        route.send(JSON.stringify({ type: 'STATE', state: game }));
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('.phase-track .current span')).toHaveText('Study');
  await dismissOverlay(page);
  return (state: GameState) => {
    expect(socket, 'The fixture socket must be connected').toBeDefined();
    socket!.send(JSON.stringify({ type: 'STATE', state }));
  };
}

async function expectCardIcons(card: Locator, canonical: Card, school: SchoolIcon) {
  const type = getSpellType(canonical), label = typeLabels[type];
  const badge = card.locator('.spell-type');
  await expect(badge).toHaveAttribute('data-spell-type', type);
  await expectSpellType(badge, `${label}${canonical.ongoing ? ' · Ongoing' : ''}`);
  await expectSpellIcon(card, label);
  await expect(badge.locator('.school-icon')).toHaveCount(0);

  const rune = card.locator('.spell-rune');
  await expectSchoolIcon(rune, school);
  await expect(card.locator('.school-icon')).toHaveCount(1);
  await expect(rune.locator(':scope > *')).toHaveCount(1);
  await expect(rune.locator(':scope > .school-icon')).toHaveCount(1);
  await expect(rune.getByRole('img')).toHaveCount(1);
  await expect(rune).toHaveText(school.glyph);
  await expect(rune.locator('.spell-type-icon')).toHaveCount(0);
  await expect(card.getByRole('img')).toHaveCount(2);

  // Check the first real label character, not a whole wrapped badge rectangle.
  // This works for text glyphs and the bear-trap SVG alike on narrow cards.
  const inline = await badge.evaluate(element => {
    const icon = element.querySelector('.spell-type-icon')!.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const offset = node.textContent?.search(/\S/) ?? -1;
      if (offset < 0 || node.parentElement?.closest('[role="img"]')) continue;
      const range = document.createRange();
      range.setStart(node, offset); range.setEnd(node, offset + 1);
      const text = range.getBoundingClientRect();
      return { iconRight: icon.right, textLeft: text.left,
        overlap: Math.min(icon.bottom, text.bottom) - Math.max(icon.top, text.top) };
    }
    throw new Error('Spell type must have a text label beside its icon');
  });
  expect(inline.iconRight).toBeLessThanOrEqual(inline.textLeft + 2);
  expect(inline.overlap, 'The type icon and label must share a line').toBeGreaterThan(0);
  const [cardBox, runeBox] = await Promise.all([card.boundingBox(), rune.boundingBox()]);
  expect(cardBox).not.toBeNull(); expect(runeBox).not.toBeNull();
  expect(Math.abs(runeBox!.x + runeBox!.width / 2 - cardBox!.x - cardBox!.width / 2),
    'The school rune must remain centered on the card').toBeLessThanOrEqual(2);
}

for (const viewport of [{ width: 1440, height: 1200 }, { width: 390, height: 844 }]) {
  test.describe(`school and type icons at ${viewport.width}px`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });
    let errors: string[];
    test.beforeEach(async ({ page }) => {
      errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    });
    test.afterEach(() => expect(errors, 'Icon rendering must not cause browser errors').toEqual([]));

    test('canonical card school glyphs match Study choices independently of all four inline types', async ({ page }, info) => {
      const game = fixture(), before = physicalIds(game);
      expect(before).toHaveLength(120); expect(new Set(before).size).toBe(120);
      const update = await mount(page, game), glyphs = new Map<string, string>();
      const choices = page.locator('.schools button');
      await expect(choices).toHaveCount(3);
      for (const deck of game.library) {
        const expected = schools[deck.id as keyof typeof schools];
        expect(expected, `Known Study school ${deck.id}`).toBeDefined();
        const choice = page.locator(`.schools button[data-school-id="${deck.id}"]`);
        await expect(choice.locator('strong')).toHaveText(deck.name);
        const icon = await expectSchoolIcon(choice, expected);
        await expect(choice.getByRole('img')).toHaveCount(1);
        await expect(choice.locator('.spell-type-icon')).toHaveCount(0);
        glyphs.set(deck.id, (await icon.textContent())!.trim());
      }
      await info.attach(`study-school-icons-${viewport.width}`, {
        body: await page.locator('.schools').screenshot({ path: info.outputPath(`study-school-icons-${viewport.width}.png`) }), contentType: 'image/png',
      });

      // Reserve actual physical cards before any shuffled allocation. Their
      // schoolId, not their type, name, or the mage's starting choice, is truth.
      const cards = ['Arcane Bolt', 'Mending Light', 'Stolen Sigil', 'Threshold Snare',
        'Thorn Retort', 'Thorned Path', "Pilgrim's Mark"].map(name => take(game, name));
      const enchantments = cards.filter(card => card.schoolId === 'enchantment');
      expect(new Set(enchantments.map(getSpellType))).toEqual(new Set<SpellType>(['COMBAT', 'CONTINGENCY', 'TRAP', 'PROTECTION']));
      expect(new Set(cards.filter(card => card.schoolId === 'transmutation').map(getSpellType)).size).toBe(2);
      game.players[0].hand = cards; game.players[0].studyDrawn = true;
      game.players[0].studyCardIds = enchantments.map(card => card.id);
      update(game);
      await expect(page.locator('.schools')).toHaveCount(0);
      for (const phase of ['STUDY', 'PREPARATION'] as const) {
        game.phase = phase; update(game);
        await expect(page.locator('.phase-track .current span')).toHaveText(phase === 'STUDY' ? 'Study' : 'Preparation');
        await dismissOverlay(page);
        const rendered = page.locator('.phase-panel .spell');
        await expect(rendered).toHaveCount(cards.length);
        await expect(page.locator('.phase-panel .spell:enabled')).toHaveCount(phase === 'STUDY' ? 4 : cards.length);
        for (const canonical of cards) {
          expect(canonical.schoolId).toBeDefined();
          const school = schools[canonical.schoolId as keyof typeof schools];
          const button = rendered.filter({ has: page.getByText(canonical.name, { exact: true }) });
          await expectCardIcons(button, canonical, school);
          await expect(button.locator('.spell-rune .school-icon')).toHaveText(glyphs.get(canonical.schoolId!)!);
        }
        expect(physicalIds(game)).toEqual(before);
      }

      // One known school covers all four types simultaneously in prepared slots.
      game.phase = 'ACTION'; game.currentPlayerId = 'p1';
      game.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
        spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
      game.players[0].preparationDone = true;
      game.players[0].hand = cards.filter(card => card.schoolId !== 'enchantment');
      for (const [index, slot] of (['slot1', 'slot2', 'slot3', 'rapid'] as const).entries()) {
        game.players[0].prepared[slot] = { card: enchantments[index], used: false };
      }
      update(game);
      await expect(page.locator('.phase-track .current span')).toHaveText('Action');
      await dismissOverlay(page);
      await selectSpells(page);
      await expect(page.locator('.prepared .spell')).toHaveCount(4);
      for (const canonical of enchantments) {
        const button = page.locator('.prepared .spell').filter({ has: page.getByText(canonical.name, { exact: true }) });
        await expectCardIcons(button, canonical, schools[canonical.schoolId as keyof typeof schools]);
      }
      expect(physicalIds(game)).toEqual(before);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await info.attach(`prepared-school-and-type-icons-${viewport.width}`, {
        body: await page.locator('.cards.prepared').screenshot({ path: info.outputPath(`prepared-school-and-type-icons-${viewport.width}.png`) }), contentType: 'image/png',
      });
    });

    test('unknown, nonschool and Forgotten cards have explicitly labeled central fallbacks, not type icons', async ({ page }) => {
      const game = fixture(), before = physicalIds(game);
      const unknown = take(game, 'Arcane Bolt'); unknown.schoolId = 'unknown-school';
      const nonschool = take(game, 'Mending Light'); delete nonschool.schoolId;
      const forgotten = game.powerfulDeck.pop()!;
      expect(forgotten.powerful).toBe(true); expect(forgotten.schoolId).toBeUndefined();
      const cases = [
        { card: unknown, school: { id: 'unaligned', label: 'Unaligned spell', glyph: '✺' } },
        { card: nonschool, school: { id: 'unaligned', label: 'Unaligned spell', glyph: '✺' } },
        { card: forgotten, school: { id: 'forgotten', label: 'Forgotten spells', glyph: '✺' } },
      ];
      // Four actual eligible school draws coexist with the held Forgotten card.
      const extra = [take(game, 'Stolen Sigil'), take(game, 'Threshold Snare')];
      game.players[0].hand = [...cases.map(item => item.card), ...extra]; game.players[0].studyDrawn = true;
      game.players[0].studyCardIds = [unknown, nonschool, ...extra].map(card => card.id);
      await mount(page, game);
      const rendered = page.locator('.phase-panel .spell');
      await expect(rendered).toHaveCount(cases.length + extra.length);
      await expect(page.locator('.phase-panel .spell:enabled')).toHaveCount(4);
      for (const { card, school } of cases) {
        const button = rendered.filter({ has: page.getByText(card.name, { exact: true }) });
        await expectCardIcons(button, card, school);
      }
      await expect(rendered.filter({ has: page.getByText(forgotten.name, { exact: true }) })).toBeDisabled();
      expect(physicalIds(game)).toEqual(before);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}