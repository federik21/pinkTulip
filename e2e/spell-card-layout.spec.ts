import { expect, test } from '@playwright/test';
import { createGame, getMainMoments, isUnstable } from '../packages/game-engine/src';
import { assignPreparationCard, selectSpells } from './layout-ui';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`spell card face layout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());

    const game = createGame(2);
    game.gameId = 'spell-card-layout';
    game.phase = 'STUDY';
    game.currentPlayerId = null;
    game.activation = null;
    game.players.forEach(player => { player.connected = true; });
    const deck = game.library.find(school => school.cards.some(card => isUnstable(card) && !!card.rulesText && getMainMoments(card).length > 0));
    expect(deck, 'The fixture needs an unstable spell with printed card text').toBeDefined();
    const index = deck!.cards.findIndex(card => isUnstable(card) && !!card.rulesText && getMainMoments(card).length > 0);
    const card = deck!.cards.splice(index, 1)[0];
    game.players[0].hand = [card];
    game.players[0].studyDrawn = true;
    game.players[0].studyCardIds = [card.id];

    await page.routeWebSocket('**', route => {
      route.onMessage(data => {
        if (JSON.parse(String(data)).type === 'CREATE_ROOM') {
          route.send(JSON.stringify({ type: 'WELCOME', playerId: game.players[0].id, roomId: game.gameId }));
          route.send(JSON.stringify({ type: 'STATE', state: game }));
        }
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Online play', exact: true }).click();
    await page.getByRole('button', { name: 'Create room', exact: true }).click();
    const spell = page.locator('.phase-panel .spell').filter({ hasText: card.name });
    await expect(spell).toBeVisible();
    await expect(spell.locator('.spell-title')).toContainText(card.name);
    await expect(spell.locator('.spell-title .spell-rune .school-icon')).toBeVisible();
    await expect(spell.locator('.spell-light-side')).toBeVisible();
    await expect(spell.locator('.spell-dark-side')).toBeVisible();
    await expect(spell.locator('.spell-light-side .spell-meta-line .spell-type-icon')).toBeVisible();
    await expect(spell.locator('.spell-light-side .spell-meta-line')).toContainText(`Range ${card.range === Number.POSITIVE_INFINITY ? '∞' : card.range}`);
    await expect(spell.locator('.spell-light-side .spell-meta-line')).toContainText('Target:');
    await expect(spell.locator('.spell-instability-note')).toHaveCount(1);
    const titleBottom = await spell.locator('.spell-title').evaluate(title => title.getBoundingClientRect().bottom);
    const instabilityTop = await spell.locator('.spell-instability-note').evaluate(note => note.getBoundingClientRect().top);
    expect(titleBottom).toBeLessThanOrEqual(instabilityTop);
    await expect(spell.locator('.spell-light-side .spell-effects')).toBeVisible();
    await expect(spell.locator('.spell-dark-side .spell-meta-line')).toBeVisible();
    if (card.rulesText) await expect(spell.locator('.spell-light-side .spell-rules')).toHaveText(card.rulesText);

    const boxes = await spell.evaluate(element => {
      const selectors = ['.spell-title', '.spell-instability-note', '.spell-light-side', '.spell-dark-side'];
      return selectors.map(selector => {
        const rect = element.querySelector(selector)!.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, width: rect.width };
      });
    });
    expect(boxes.every(box => box.width > 0)).toBe(true);
    expect(boxes[0].bottom).toBeLessThan(boxes[1].top + 1);
    expect(boxes[1].bottom).toBeLessThan(boxes[2].top + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`face selection stays inside the card and casting shows only that face at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const game = createGame(2);
    game.gameId = 'spell-face-selection';
    game.phase = 'PREPARATION';
    game.currentPlayerId = null;
    game.activation = null;
    game.players.forEach(player => { player.connected = true; });
    const me = game.players[0];
    const deck = game.library[0];
    const darkCard = deck.cards.shift()!;
    const lightIndex = deck.cards.findIndex(card => getMainMoments(card).length > 0);
    expect(lightIndex, 'The fixture needs an effect-bearing light face').toBeGreaterThanOrEqual(0);
    const lightCard = deck.cards.splice(lightIndex, 1)[0];
    me.hand = [darkCard, lightCard];

    let publish = (_state: typeof game) => {};
    await page.routeWebSocket('**', route => {
      publish = state => route.send(JSON.stringify({ type: 'STATE', state }));
      route.onMessage(data => {
        if (JSON.parse(String(data)).type === 'CREATE_ROOM') {
          route.send(JSON.stringify({ type: 'WELCOME', playerId: me.id, roomId: game.gameId }));
          publish(game);
        }
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Online play', exact: true }).click();
    await page.getByRole('button', { name: 'Create room', exact: true }).click();
    const phaseOverlay = page.locator('.phase-overlay');
    if (await phaseOverlay.isVisible()) { await expect(phaseOverlay).toBeVisible(); await phaseOverlay.click(); await expect(phaseOverlay).toBeHidden(); }

    const darkChoice = page.locator('.preparation-panel .spell').filter({ hasText: darkCard.name });
    expect(await darkChoice.evaluate(element => element.tagName)).toBe('ARTICLE');
    await expect(darkChoice.locator('.spell-face-select')).toHaveCount(2);
    await darkChoice.getByRole('button', { name: `Choose dark face of ${darkCard.name}` }).click();
    await expect(darkChoice.locator('.spell-dark-side')).toHaveAttribute('data-selected', 'true');
    await expect(darkChoice.getByRole('button', { name: `Choose dark face of ${darkCard.name}` })).toHaveAttribute('aria-pressed', 'true');
    await expect(darkChoice.locator('.spell-dark-side')).toHaveCSS('border-color', 'rgb(118, 207, 145)');
    await expect(darkChoice.locator('.spell-light-side .eyebrow, .spell-dark-side .eyebrow')).toHaveCount(0);

    const lightChoice = page.locator('.preparation-panel .spell').filter({ hasText: lightCard.name });
    await expect(lightChoice.getByRole('button', { name: `Choose light face of ${lightCard.name}` })).toHaveAttribute('aria-pressed', 'true');
    await darkChoice.locator('.spell-dark-side').click();
    await page.getByRole('button', { name: 'Place in slot 1' }).click();
    await assignPreparationCard(page, lightChoice, 2);
    await expect(page.locator('.preparation-order').getByRole('button', { name: /Place in slot 1/ })).toContainText(darkCard.name);
    await expect(page.locator('.preparation-order').getByRole('button', { name: /Place in slot 2/ })).toContainText(lightCard.name);
    await expect(page.locator('.preparation-slot-cards')).toHaveCount(0);
    await expect(darkChoice).toBeVisible();
    await expect(lightChoice).toBeVisible();

    me.hand = [];
    me.preparationDone = true;
    me.prepared.slot1 = { card: darkCard, used: false, side: 'DARK' };
    me.prepared.slot2 = { card: lightCard, used: false };
    game.phase = 'ACTION';
    game.currentPlayerId = me.id;
    game.activation = { playerId: me.id, actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
      spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
    publish(game);
    if (await phaseOverlay.isVisible()) { await expect(phaseOverlay).toBeVisible(); await phaseOverlay.click(); await expect(phaseOverlay).toBeHidden(); }
    await selectSpells(page);

    const castDark = page.locator('.prepared .spell').filter({ hasText: darkCard.name });
    await expect(castDark.locator('.spell-dark-side')).toBeVisible();
    await expect(castDark.locator('.spell-light-side')).toHaveCount(0);
    await expect(castDark.locator('.spell-face-select')).toHaveCount(0);
    if (darkCard.darkSide?.element) {
      await expect(castDark.locator('.spell-dark-side .spell-element')).toHaveAttribute('data-element', darkCard.darkSide.element);
    } else {
      await expect(castDark.locator('.spell-dark-side .spell-element')).toHaveCount(0);
    }
    const castLight = page.locator('.prepared .spell').filter({ hasText: lightCard.name });
    await expect(castLight.locator('.spell-light-side')).toBeVisible();
    await expect(castLight.locator('.spell-dark-side')).toHaveCount(0);
  });
}
