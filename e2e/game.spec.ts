import { test, expect, Page, Browser, TestInfo, Locator } from '@playwright/test';

type Mage = { page: Page; id: string; name: string; coordinates: string };

async function dismissOverlay(page: Page) {
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
}

function hex(page: Page, coordinates: string, reachable = false) {
  return page.locator(`g.hex${reachable ? '.reachable' : ''}[data-room-id="room-${coordinates}"]`);
}

async function roomName(page: Page, coordinates: string) {
  return (await hex(page, coordinates).locator('text.room-name tspan').allTextContents()).map(line => line.trim()).join(' ');
}

async function expectEvocationLocation(page: Page, id: string, mage: Mage, coordinates = mage.coordinates) {
  await expect(page.locator(`[data-evocation-id="${id}"] > small`)).toHaveText(`${mage.name} · Undead · ${await roomName(page, coordinates)}`);
}

function player(page: Page, name: string) {
  return page.locator('.player').filter({
    has: page.locator('.player-heading', { hasText: name }),
  });
}

async function expectTokens(page: Page, name: string, tokens: number) {
  await expect(player(page, name).locator('.player-stats > span').filter({ hasText: /^⚡/ }))
    .toHaveText(`⚡ ${tokens}`);
}

async function expectRemovedControls(page: Page) {
  await expect(page.getByRole('button', { name: /^Summon\b/ })).toHaveCount(0);
  await expect(page.getByLabel('Free room effect timing', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Begin movement|Activate room|Punch)\b/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Move here|Choose another destination|Activate room & finish)/ })).toHaveCount(0);
}

const exploreButton = (page: Page) => page.getByRole('button', { name: /^Explore\s+1 token/ });
const attackButton = (page: Page) => page.getByRole('button', { name: /^Attack\s+1 token/ });
const movementButton = (page: Page) => page.getByRole('button', { name: /^Perform 2 movements/ });
const roomButton = (page: Page) => page.getByRole('button', { name: /^Activate the room/ });

async function expectActions(mage: Mage, left: number) {
  await expect(mage.page.locator('.phase-panel .badge')).toHaveText(`${left} turn actions left`);
}

async function tokensOf(mage: Mage) {
  return Number((await player(mage.page, mage.name).locator('.player-stats > span').filter({ hasText: /^⚡/ }).textContent())!.replace('⚡ ', ''));
}

// A broadcast and its request ACK can render separately. Require coherent ownership
// in both browsers and an enabled legal control, not merely the next STATE's heading.
async function actionOwner(mages: Mage[], nextPhase?: string) {
  const pages = mages.map(mage => mage.page);
  let owner: Mage | undefined;
  await expect.poll(async () => {
    const phases = await Promise.all(pages.map(page => page.locator('.phase-track .current span').textContent()));
    if (nextPhase && phases.every(phase => phase === nextPhase)) { owner = undefined; return true; }
    if (!phases.every(phase => phase === 'Action')) return false;
    const names = await Promise.all(pages.map(page => page.locator('.turn-banner strong').textContent()));
    owner = mages.find(mage => names.every(name => name === mage.name));
    if (!owner) return false;
    const headings = await Promise.all(pages.map(page => page.getByRole('heading', { name: 'Choose your next action', exact: true }).isVisible()));
    return headings.filter(Boolean).length === 1 && headings[pages.indexOf(owner.page)] &&
      await owner.page.locator('.actions-panel button:enabled, .prepared .spell:enabled, .powerful-panel .spell:enabled').count() > 0;
  }, { message: `Both browsers must agree on a ready Action owner${nextPhase ? ` or ${nextPhase}` : ''}` }).toBe(true);
  return owner;
}

async function endTurn(mage: Mage, mages: Mage[]) {
  await expect(mage.page.getByRole('button', { name: /^End turn\b/ })).toBeEnabled();
  await mage.page.getByRole('button', { name: /^End turn\b/ }).click();
  const next = await actionOwner(mages);
  expect(next?.id, 'A legal early end must hand off to the other mage').not.toBe(mage.id);
  await expectActing(mages.map(candidate => candidate.page), next!);
}

async function castPrepared(mage: Mage, pages: Page[], card: Locator) {
  const tokens = await tokensOf(mage);
  const left = Number((await mage.page.locator('.phase-panel .badge').textContent())!.match(/^(\d)/)![1]);
  const label = (await card.locator('.eyebrow').textContent())!.trim();
  const numbered = /^Spell [123] ·/.test(label);
  const used = await mage.page.locator('.prepared .spell.used').count();
  await expect(card).toBeEnabled();
  await expect(card).toContainText('1 action to cast');
  await card.click();
  if (label.endsWith(' · Model')) await mage.page.getByRole('button', { name: 'Target dummy · no damage', exact: true }).click();
  // Harmless same-room targets preserve the real summons and mage health.
  await hex(mage.page, mage.coordinates, true).click();
  await mage.page.locator('.room-detail').getByRole('button', { name: /^Cast .* here/ }).click();
  await expect.poll(async () =>
    await mage.page.locator('.phase-track .current span').textContent() !== 'Action' ||
    await mage.page.locator('.prepared .spell.used').count() === used + 1,
    { message: 'A cast must spend exactly its preparation before the next action' }
  ).toBe(true);
  for (const page of pages) {
    await expectTokens(page, mage.name, tokens);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  if (left === 2 && tokens > 0) await expectActions(mage, 1);
  return { numbered, left };
}

const mageColors = ['rgb(251, 113, 133)', 'rgb(96, 165, 250)', 'rgb(251, 191, 36)', 'rgb(52, 211, 153)'];

async function expectAttributes(pages: Page[], count = pages.length) {
  for (const page of pages) {
    await expect(page.locator('.player')).toHaveCount(count);
    await expect(page.locator('.mage-legend [data-player-id]')).toHaveCount(count);
    for (let index = 0; index < count; index++) {
      const id = `p${index + 1}`;
      const stats = page.locator(`.player[data-player-id="${id}"] dl.mage-attributes`);
      await expect(stats.locator('dt')).toHaveText(['Max HP', 'Attack', 'Movement', 'Card limit', 'Quest limit']);
      await expect(stats.locator('dd')).toHaveText(['10', '2', '2', '7', '2']);
      await expect(page.locator(`.player[data-player-id="${id}"] .health i`)).toHaveCSS('background-color', mageColors[index]);
      await expect(page.locator(`.mage-legend [data-player-id="${id}"] i`)).toHaveCSS('background-color', mageColors[index]);
      await expect(page.locator(`.board [data-mage-id="${id}"] .mage-token-disc`)).toHaveCSS('stroke', mageColors[index]);
    }
  }
}

async function expectPhysicalLock(mage: Mage, pages: Page[], kind: 'EXPLORE' | 'ATTACK') {
  await expect(mage.page.locator('.physical-effects')).toHaveAttribute('data-physical-kind', kind);
  await expect(mage.page.getByRole('heading', { name: kind === 'EXPLORE' ? 'Explore effects' : 'Attack effects', exact: true })).toBeVisible();
  await expect(mage.page.locator('.prepared .spell:not(:disabled), .powerful-panel .spell:not(:disabled)')).toHaveCount(0);
  await expect(mage.page.getByRole('button', { name: /^End turn\b/ })).toBeDisabled();
  await expect(mage.page.getByRole('button', { name: 'Pass for this round', exact: true })).toBeDisabled();
  await expect(mage.page.locator('.evocation-card[data-owned="true"] button:not(:disabled)')).toHaveCount(0);
  await expect(exploreButton(mage.page)).toHaveCount(0);
  await expect(attackButton(mage.page)).toHaveCount(0);
  await expect(mage.page.getByRole('button', { name: 'Skip remaining effects', exact: true })).toBeEnabled();
  for (const page of pages) {
    await expectRemovedControls(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
    if (page !== mage.page) {
      await expect(page.locator('.physical-effects, .attack-targets')).toHaveCount(0);
      await expect(page.locator('g.hex.reachable')).toHaveCount(0);
    }
  }
}

async function beginPhysical(mage: Mage, pages: Page[], kind: 'EXPLORE' | 'ATTACK', tokens: number) {
  await (kind === 'EXPLORE' ? exploreButton(mage.page) : attackButton(mage.page)).click();
  await expectPhysicalLock(mage, pages, kind);
  for (const page of pages) await expectTokens(page, mage.name, tokens);
}

async function move(mage: Mage, pages: Page[], path: string[]) {
  await movementButton(mage.page).click();
  await expect(mage.page.locator('.movement-progress strong')).toHaveText('2 movement remaining');
  await expect(roomButton(mage.page)).toBeDisabled();
  await expect(mage.page.locator('g.hex.start-room.reachable')).toHaveCount(0);
  for (const [index, coordinates] of path.entries()) {
    await hex(mage.page, coordinates, true).click();
    await expectMageAt(pages, mage, coordinates);
    mage.coordinates = coordinates;
    if (index === 0) await expect(mage.page.locator('.movement-progress strong')).toHaveText('1 movement remaining');
  }
  if (path.length < 2) await mage.page.getByRole('button', { name: 'Finish movement early', exact: true }).click();
  await expect(mage.page.locator('.movement-progress')).toHaveCount(0);
  await expectRemovedControls(mage.page);
}

async function skipEffects(mage: Mage, pages: Page[]) {
  const positions = await mage.page.locator('.board [data-mage-id]').count();
  const models = await mage.page.locator('.evocation-card').count();
  await mage.page.getByRole('button', { name: 'Skip remaining effects', exact: true }).click();
  await expect(mage.page.locator('.physical-effects, .movement-progress')).toHaveCount(0);
  for (const page of pages) {
    await expect(page.locator('.board [data-mage-id]')).toHaveCount(positions);
    await expect(page.locator('.evocation-card')).toHaveCount(models);
    await expectMageAt([page], mage, mage.coordinates);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
}

async function expectActing(pages: Page[], mage: Mage, activity = 'Taking an Action turn') {
  for (const page of pages) {
    const banner = page.locator('.turn-banner');
    await expect(banner).toHaveCount(1);
    await expect(banner).toBeVisible();
    await expect(banner.locator('strong')).toHaveText(mage.name);
    await expect(banner.locator('.eyebrow')).toHaveText(page === mage.page ? 'Your turn' : 'Mage acting');
    await expect(banner.locator('small')).toHaveText(activity);
    await expect(page.locator('.player.active-player')).toHaveCount(1);
    await expect(page.locator('.player.active-player')).toHaveAttribute('data-player-id', mage.id);
    await expect(player(page, mage.name)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.player[aria-current="true"]')).toHaveCount(1);
    const token = page.locator('.board .acting-mage-token[data-mage-id]');
    await expect(token).toHaveCount(1);
    await expect(token).toHaveAttribute('data-mage-id', mage.id);
    await expect(page.locator('g.hex.acting-room')).toHaveCount(1);
    await expect(page.locator(`g.hex.acting-room .acting-mage-token[data-mage-id="${mage.id}"]`)).toHaveCount(1);
    await expect(token).toHaveCSS('animation-name', 'mage-breathe');
    await expect(token).toHaveCSS('animation-iteration-count', 'infinite');
    await expect(token).toHaveCSS('filter', /drop-shadow/);
    await expect(banner.locator(':scope > .acting-mage-icon')).toHaveCSS('animation-name', 'mage-breathe');
    await expect(page.locator('.player.active-player')).toHaveCSS('animation-name', 'mage-glow');
    const resting = page.locator('.board [data-mage-id]:not(.acting-mage-token)');
    await expect(resting).toHaveCount(pages.length - 1);
    for (const token of await resting.all()) await expect(token).toHaveCSS('animation-name', 'none');
    await expectRemovedControls(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
}

async function expectNoActingMage(pages: Page[]) {
  for (const page of pages) {
    await expect(page.locator('.turn-banner, .player.active-player, .acting-mage-token, g.hex.acting-room')).toHaveCount(0);
    await expect(page.locator('.player[aria-current="true"]')).toHaveCount(0);
  }
}

async function expectMageAt(pages: Page[], mage: Mage, coordinates: string) {
  for (const page of pages) {
    await expect(hex(page, coordinates).locator(`[data-mage-id="${mage.id}"]`)).toHaveCount(1);
    await expect(hex(page, coordinates)).toHaveAttribute('aria-label', new RegExp(mage.name));
  }
}

async function expectPhase(pages: Page[], phase: string) {
  for (const page of pages) {
    await expect(page.locator('.phase-track .current span')).toHaveText(phase);
    await dismissOverlay(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
}

async function studyCards(pages: Page[]) {
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Six schools. Infinite possibilities.', exact: true })).toBeVisible();
    await dismissOverlay(page);
    await page.getByRole('button', { name: /School 1\b/ }).click();
    await expect(page.locator('.phase-panel .spell').nth(5)).toBeVisible();
    const cards = page.locator('.phase-panel .spell');
    const count = await cards.count();
    // Keep the two grimoire draws and two school cards. Later rounds retain held cards too.
    await cards.nth(count - 2).click();
    await cards.nth(count - 1).click();
    await page.getByRole('button', { name: 'Discard selected (2/2)', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Discard selected (2/2)', exact: true })).toHaveCount(0);
  }
  await expectPhase(pages, 'Preparation');
}

async function prepareCards(pages: Page[]) {
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Three ordered spells. One wild card.', exact: true })).toBeVisible();
    await dismissOverlay(page);
    await expect(page.locator('.phase-panel .spell').nth(3)).toBeVisible();
    for (let i = 0; i < 4; i++) await page.locator('.phase-panel .spell').nth(i).click();
    await page.getByRole('button', { name: 'Prepare spells', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Prepare spells', exact: true })).toHaveCount(0);
  }
  await expectPhase(pages, 'Action');
}

async function studyAndPrepare(pages: Page[]) {
  await studyCards(pages);
  await prepareCards(pages);
}

async function expectGreySummon(mage: Mage, pages: Page[], total: number, handedOff = false) {
  const own = mage.page.locator('.evocations-panel .evocation-card[data-owned="true"]');
  await expect(own).toHaveCount(1);
  const id = await own.getAttribute('data-evocation-id');
  expect(id).toBeTruthy();
  for (const page of pages) {
    const model = page.locator(`.evocations-panel .evocation-card[data-evocation-id="${id}"]`);
    await expectEvocationLocation(page, id!, mage);
    await expect(model.locator('.model-stats > span')).toHaveText(['↝ 2', '⚔ 2', '♥ 2/2']);
    await expect(model).toContainText('Wounded Fury: +1 attack per damage taken.');
    await expect(hex(page, mage.coordinates).locator('.evocation-marker')).toHaveText('☠1');
    await expect(page.locator('.evocations-panel .evocation-card')).toHaveCount(total);
    await expect(page.locator('.log > div').filter({ hasText: `${mage.name} summons a Cadaver from the Grey room (Undead · move 2 · attack 2 · health 2).` }))
      .toBeVisible();
    await expectTokens(page, mage.name, 1);
    await expectRemovedControls(page);
  }
  if (handedOff) {
    await expect(mage.page.locator('.phase-panel .badge')).toHaveText('Waiting');
    await expect(own.getByRole('button', { name: /^Activate Cadaver\b/ })).toBeDisabled();
  } else {
    await expectActions(mage, 1);
    await expect(own.getByRole('button', { name: /^Activate Cadaver\b/ })).toBeEnabled();
  }
  return id!;
}

async function extraEvocationActivation(mage: Mage, pages: Page[], id: string, total: number, next?: Mage) {
  const own = mage.page.locator(`.evocation-card[data-evocation-id="${id}"]`);
  const activate = own.getByRole('button', { name: /^Activate Cadaver\b/ });
  await expect(activate.locator('small')).toHaveText('1 token · extra activation');
  await expect(activate).toBeEnabled();
  await activate.click();
  await expectActing(pages, mage, 'Controlling an evocation');
  await expect(own).toHaveClass(/active-model/);
  await expect(mage.page.getByRole('heading', { name: 'Finish your evocation activation', exact: true })).toBeVisible();
  await expect(mage.page.locator('.evocation-controls')).toContainText('2 movement remaining.');
  const observer = pages.find(page => page !== mage.page)!;
  await expect(observer.getByRole('button', { name: 'Finish evocation', exact: true })).toHaveCount(0);
  await expect(observer.locator('g.hex.reachable')).toHaveCount(0);
  for (const page of pages) {
    await expectTokens(page, mage.name, 0);
    await expect(page.locator('.evocation-card')).toHaveCount(total);
    await expectEvocationLocation(page, id, mage);
  }
  await expect(activate).toBeDisabled();
  // Spend the extra activation without moving or attacking; it must not summon another model.
  await mage.page.getByRole('button', { name: 'Finish evocation', exact: true }).click();
  await expectActing(pages, next ?? mage);
  for (const page of pages) {
    await expect(page.locator('.evocation-controls')).toHaveCount(0);
    await expect(page.locator('.evocation-card')).toHaveCount(total);
    await expectEvocationLocation(page, id, mage);
    await expect(page.locator('.log > div').filter({ hasText: `${mage.name} summons a Cadaver from the Grey room` })).toHaveCount(1);
    await expectTokens(page, mage.name, 0);
  }
  await expect(mage.page.locator('.phase-panel .badge')).toHaveText(next ? 'Waiting' : '1 turn actions left');
  await expect(activate).toBeDisabled();
  if (next) {
    await expect(exploreButton(mage.page)).toHaveCount(0);
    await expect(attackButton(mage.page)).toHaveCount(0);
  } else {
    await expect(mage.page.getByRole('button', { name: 'Pass for this round', exact: true })).toBeDisabled();
    await expect(exploreButton(mage.page)).toBeDisabled();
    await expect(attackButton(mage.page)).toBeDisabled();
  }
}

// Read only visible turn/phase controls. No injected state, socket commands, or server shortcuts.
async function drainSpells(mages: Mage[], expectedCasts = 7, nextPhase = 'Evocation') {
  const pages = mages.map(mage => mage.page);
  let casts = 0;
  let checkedNumberedQuota = false;
  let castFlexible = false;
  for (let step = 0; step < 24; step++) {
    const mage = await actionOwner(mages, nextPhase);
    if (!mage) {
      expect(casts, 'All remaining preparations must be cast before Action ends').toBe(expectedCasts);
      expect(checkedNumberedQuota, 'A numbered cast must lock later numbered slots on that turn').toBe(true);
      expect(castFlexible, 'Flexible spells must remain usable alongside a numbered spell').toBe(true);
      for (const page of pages) {
        await expect(page.locator('.prepared')).toHaveCount(0);
        await expect(page.locator('.log > div').filter({ hasText: /passes for the rest of the Action phase/ })).toHaveCount(0);
      }
      return;
    }

    const { page } = mage;
    await expectActing(pages, mage);
    await expectTokens(page, mage.name, 0);
    await expect(page.locator('.phase-panel .badge')).toHaveText(/[12] turn actions left/);
    await expect(page.getByRole('button', { name: 'Pass for this round', exact: true })).toBeDisabled();
    await expect(exploreButton(page)).toBeDisabled();
    await expect(attackButton(page)).toBeDisabled();
    await expectRemovedControls(page);
    const enabled = page.locator('.prepared .spell:not(:disabled)');
    expect(await enabled.count(), `${mage.name} has no tokens: exhaustion must hand off rather than strand future slots`).toBeGreaterThan(0);
    expect(await enabled.filter({ hasText: /Spell [123] ·/ }).count()).toBeLessThanOrEqual(1);
    const { numbered, left } = await castPrepared(mage, pages, enabled.first());
    casts++;
    if (!numbered) castFlexible = true;
    const next = await actionOwner(mages, nextPhase);
    if (numbered && left === 2 && next === mage && await page.locator('.prepared .spell:not(:disabled)').filter({ hasText: '✧ Flexible' }).count()) {
      await expectActions(mage, 1);
      await expect(page.locator('.prepared .spell:not(:disabled)').filter({ hasText: /Spell [123] ·/ })).toHaveCount(0);
      checkedNumberedQuota = true;
    }
    if (left === 1 && next && next !== mage) {
      await expect(page.locator('.prepared .spell:not(:disabled)')).toHaveCount(0);
      await expect(page.locator('.phase-panel .badge')).toHaveText('Waiting');
      await expectActions(next, 2);
    }
    for (const observer of pages) {
      await expect(observer.getByRole('alert')).toHaveCount(0);
      await expectTokens(observer, mage.name, 0);
    }
  }
  throw new Error(`Action did not exhaust within 24 visible spell casts (${casts} casts completed)`);
}

test('two browsers exhaust two round tokens, spend turn actions on spells, and resolve evocations through visible controls', async ({ browser }, testInfo) => {
  const a = await browser.newPage({ reducedMotion: 'no-preference' }), b = await browser.newPage({ reducedMotion: 'no-preference' });
  const pages = [a, b];
  const ember: Mage = { page: a, id: 'p1', name: 'Ember Browser', coordinates: '1,-1' };
  const moon: Mage = { page: b, id: 'p2', name: 'Moon Browser', coordinates: '-2,1' };
  const pageErrors: string[][] = [[], []];
  const dialogs: string[][] = [[], []];
  pages.forEach((page, i) => {
    page.on('pageerror', error => pageErrors[i].push(error.message));
    page.on('dialog', async dialog => { dialogs[i].push(dialog.message()); await dialog.dismiss(); });
  });
  try {
    await test.step('Join, ready, Study, and prepare four spells each', async () => {
      await a.goto('/');
      await b.goto('/');
      const room = `browser-round-${testInfo.workerIndex}-${testInfo.retry}`;
      await a.getByLabel('Mage name').fill(ember.name);
      await a.getByLabel('Room name').fill(room);
      await a.getByRole('button', { name: 'Create room', exact: true }).click();
      await expect(a.getByRole('heading', { name: 'Gather the mages', exact: true })).toBeVisible();
      await expect(a.getByRole('button', { name: 'Start game', exact: true })).toHaveCount(0);
      await expect(a.locator('.lobby-count')).toHaveText('1 / 4 mages · 0 ready');
      await a.getByRole('button', { name: 'Mark ready', exact: true }).click();
      await expect(a.locator('.lobby-readiness')).toContainText('Waiting for at least 2 mages');
      await b.getByLabel('Mage name').fill(moon.name);
      await b.getByLabel('Room name').fill(room);
      await b.getByRole('button', { name: 'Join room', exact: true }).click();
      await b.getByRole('button', { name: 'Mark ready', exact: true }).click();
      await expectPhase(pages, 'Black Rose');
      await expectNoActingMage(pages);
      await expectAttributes(pages);
      await a.getByRole('button', { name: 'Receive quests & begin Study', exact: false }).click();
      await studyAndPrepare(pages);
    });

    await test.step('Both clients identify the acting mage; pulse and glow respect reduced motion', async () => {
      await expectActing(pages, ember);
      await expectMageAt(pages, ember, '3,-2');
      await expectMageAt(pages, moon, '-3,2');
      for (const page of pages) {
        // Inspect the rendered animation, not application state or a synthetic command.
        await expect.poll(() => page.locator('.acting-mage-token').evaluate(element =>
          element.getAnimations().some(animation => animation instanceof CSSAnimation &&
            animation.animationName === 'mage-breathe' && animation.effect instanceof KeyframeEffect &&
            new Set(animation.effect.getKeyframes().map(frame => frame.transform)).size > 1)
        )).toBe(true);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        for (const locator of [page.locator('.acting-mage-token'), page.locator('.player.active-player'),
          page.locator('.turn-banner > .acting-mage-icon'), page.locator('.active-player .acting-mage-icon')]) {
          await expect(locator).toHaveCSS('animation-name', 'none');
          await expect(locator).toHaveCSS('transition-duration', '0s');
        }
        await expect(page.locator('.acting-mage-token')).toHaveAttribute('data-mage-id', ember.id);
        await expect(page.locator('.turn-banner strong')).toHaveText(ember.name);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      await expectActing(pages, ember);
      await capture(a, testInfo, 'action-acting-ember-desktop');
    });

    let emberId = '', moonId = '';
    await test.step('Spend exactly two tokens per mage, retaining spells instead of passing', async () => {
      await expect(a.getByRole('heading', { name: 'Choose your next action', exact: true })).toBeVisible();
      for (const page of pages) {
        for (const mage of [ember, moon]) await expectTokens(page, mage.name, 2);
        await expect(page.locator('g.hex.start-room')).toHaveCount(4);
        for (const coordinates of ['-1,-2', '3,-2', '-3,2', '1,2']) await expect(hex(page, coordinates)).toHaveClass(/start-room/);
        await expect(page.locator('g.hex')).toHaveCount(23);
        for (const color of ['crimson', 'azure', 'emerald', 'amber', 'violet', 'grey']) {
          await expect(page.locator(`g.hex[data-color="${color}"]`)).toHaveCount(3);
          await expect(page.locator(`.room-legend [data-color="${color}"]`)).toHaveText(`${color} · 3`);
        }
        await expect(page.locator('[data-color="ivory"]')).toHaveCount(0);
        await expectRemovedControls(page);
        await expect(page.locator('.evocation-card')).toHaveCount(0);
      }
      await expect(a.locator('.prepared .spell:not(:disabled)')).toHaveCount(0);
      await expect(attackButton(a)).toBeDisabled();
      await expect(a.getByRole('button', { name: 'Pass for this round', exact: true })).toBeDisabled();
      // Exit options are flexible, then slots 1/2/3: discard only the third numbered preparation.
      await a.getByLabel('Card to discard for exit').selectOption({ index: 4 });
      await hex(a, '2,-2', true).click();
      await expect(a.locator('.log > div').filter({ hasText: /Ember Browser discards .*1 action.*no physical token/ })).toBeVisible();
      await expect(a.locator('.prepared .spell.used .eyebrow')).toHaveText(/^Spell 3 · (Room|Model)$/);
      await expectTokens(a, ember.name, 2);
      await expectActions(ember, 1);
      await expectMageAt(pages, ember, '2,-2');
      const emeraldCubes = (await hex(a, '1,-2').locator('.cube-count').textContent())!;
      await beginPhysical(ember, pages, 'EXPLORE', 1);
      await expect(roomButton(a)).toBeEnabled();
      await expect(a.getByLabel('Emerald effect target')).toBeEnabled();
      await movementButton(a).click();
      await expect(a.locator('.movement-progress strong')).toHaveText('2 movement remaining');
      await expect(roomButton(a)).toBeDisabled();
      for (const page of pages) {
        await expect(hex(page, '1,-2').locator('.cube-count')).toHaveText(emeraldCubes);
        await expect(page.locator('.log > div').filter({ hasText: /Ember Browser activates .*for free/ })).toHaveCount(0);
      }
      await hex(a, ember.coordinates, true).click();
      // The first step is sent immediately, but entering Grey does not activate its effect.
      await expectMageAt(pages, ember, ember.coordinates);
      await expect(a.locator('.movement-progress strong')).toHaveText('1 movement remaining');
      await expect(a.getByRole('button', { name: 'Finish movement early', exact: true })).toBeEnabled();
      await expect(roomButton(a)).toBeDisabled();
      for (const page of pages) await expect(page.locator('.evocation-card')).toHaveCount(0);
      await a.getByRole('button', { name: 'Finish movement early', exact: true }).click();
      await expectPhysicalLock(ember, pages, 'EXPLORE');
      await expect(movementButton(a)).toBeDisabled();
      await expectActions(ember, 0);
      await expectActing(pages, ember);
      await roomButton(a).click();
      await expect(a.locator('.physical-effects')).toHaveCount(0);
      emberId = await expectGreySummon(ember, pages, 1, true);
      await expectActing(pages, moon);

      await expect(b.getByRole('heading', { name: 'Choose your next action', exact: true })).toBeVisible();
      await expectActing(pages, moon);
      await expect(b.getByRole('button', { name: 'Pass for this round', exact: true })).toBeDisabled();
      await expect(attackButton(b)).toBeDisabled();
      await beginPhysical(moon, pages, 'EXPLORE', 1);
      await expect(roomButton(b)).toBeDisabled();
      await movementButton(b).click();
      await hex(b, '-2,2', true).click();
      await expectMageAt(pages, moon, '-2,2');
      await expect(b.locator('.movement-progress strong')).toHaveText('1 movement remaining');
      await hex(b, moon.coordinates, true).click();
      // The last board click is authoritative immediately, but the room effect remains pending.
      await expectMageAt(pages, moon, moon.coordinates);
      await expect(b.locator('.movement-progress')).toHaveCount(0);
      await expectPhysicalLock(moon, pages, 'EXPLORE');
      await expect(movementButton(b)).toBeDisabled();
      await expect(roomButton(b)).toBeEnabled();
      for (const page of pages) {
        await expect(page.locator('.evocation-card')).toHaveCount(1);
        await expectTokens(page, moon.name, 1);
      }
      await capture(b, testInfo, 'grey-last-step-room-still-pending');
      await roomButton(b).click();
      await expect(b.locator('.physical-effects')).toHaveCount(0);
      moonId = await expectGreySummon(moon, pages, 2);
      await extraEvocationActivation(moon, pages, moonId, 2, ember);
      await capture(b, testInfo, 'action-acting-moon-desktop');
      await expectActing(pages, ember);
      // Discard-exit consumed Ember's first action, so the paid activation now
      // belongs to a new turn rather than following a forbidden third action.
      await extraEvocationActivation(ember, pages, emberId, 2);
      await endTurn(ember, [ember, moon]);
      await castPrepared(moon, pages, b.locator('.prepared .spell').filter({ hasText: /^Spell 1 ·/ }));
      await endTurn(moon, [ember, moon]);
      await expectActing(pages, ember);
    });

    await test.step('Exhaust numbered and flexible spells through real turns; enter Evocation without a premature pass', async () => {
      await drainSpells([ember, moon], 6);
      await expectPhase(pages, 'Evocation');
      await expectActing(pages, ember, 'Choosing an evocation');
      for (const page of pages) {
        await expect(page.getByRole('heading', { name: 'Evocation phase', exact: true })).toBeVisible();
        await expect(page.locator('.evocations-panel .evocation-card')).toHaveCount(2);
        await expect(page.locator('.evocations-panel .model-stats > span')).toHaveText(['↝ 2', '⚔ 2', '♥ 2/2', '↝ 2', '⚔ 2', '♥ 2/2']);
        await expect(hex(page, ember.coordinates).locator('.evocation-marker')).toHaveText('☠1');
        await expect(hex(page, moon.coordinates).locator('.evocation-marker')).toHaveText('☠1');
      }
    });

    await test.step('Activate sequentially, move two adjacent spaces, attack only enemies, and destroy a rival summon', async () => {
      const activateA = a.locator('.evocation-card[data-owned="true"]').getByRole('button', { name: /^Activate Cadaver\b/ });
      const activateB = b.locator('.evocation-card[data-owned="true"]').getByRole('button', { name: /^Activate Cadaver\b/ });
      await expect(activateA.locator('small')).toHaveText('Free · once this phase');
      await expect(activateA).toBeEnabled();
      await expect(activateB).toBeDisabled();
      await activateA.click();
      await expectActing(pages, ember, 'Controlling an evocation');
      for (const page of pages) await expectTokens(page, ember.name, 0);
      await expect(a.locator('.evocation-controls')).toContainText('2 movement remaining.');
      await expect(a.getByRole('button', { name: 'Finish evocation', exact: true })).toBeEnabled();
      await expect(activateA).toBeDisabled();
      await expect(activateB).toBeDisabled();
      await expect(b.getByRole('button', { name: 'Finish evocation', exact: true })).toHaveCount(0);
      await expect(b.locator('g.hex.reachable')).toHaveCount(0);
      await expect(a.locator('g.hex.start-room.reachable')).toHaveCount(0);
      await hex(a, '0,0', true).click();
      await expect(a.locator('.evocation-controls')).toContainText('1 movement remaining.');
      await expect(hex(a, '0,0').locator('.evocation-marker')).toHaveText('☠1');
      await hex(a, '-1,1', true).click();
      await expect(a.locator('.evocation-controls')).toContainText('0 movement remaining.');
      await expect(a.locator('g.hex.reachable')).toHaveCount(0);
      await expectEvocationLocation(a, emberId, ember, '-1,1');
      await expect(hex(a, ember.coordinates)).toHaveAttribute('aria-label', new RegExp(ember.name));
      await expect(hex(a, ember.coordinates).locator('.evocation-marker')).toHaveCount(0);
      await expect(a.getByRole('button', { name: /^Cadaver attack Ember Browser\b/ })).toHaveCount(0);
      await expect(a.getByRole('button', { name: /^Cadaver attack Cadaver \(Ember Browser\)/ })).toHaveCount(0);
      const attackMage = a.getByRole('button', { name: /^Cadaver attack Moon Browser\b/ });
      await expect(attackMage.locator('small')).toHaveText('2 damage');
      await expect(a.getByRole('button', { name: /^Cadaver attack Cadaver \(Moon Browser\)/ })).toBeEnabled();
      await attackMage.click();
      await expectActing(pages, moon, 'Choosing an evocation');
      await expect(activateB).toBeEnabled();
      await expect(activateA).toBeDisabled();
      await expect(activateA.locator('small')).toHaveText('Already activated');
      for (const page of pages) {
        await expect(page.locator('.evocation-controls')).toHaveCount(0);
        await expect(player(page, moon.name).locator('.damage-ledger')).toContainText('Ember Browser: 2');
        await expect(player(page, ember.name).locator('.cube-pool')).toContainText('On mages: 2');
      }

      await activateB.click();
      await expectActing(pages, moon, 'Controlling an evocation');
      for (const page of pages) await expectTokens(page, moon.name, 0);
      await expect(b.locator('.evocation-controls')).toContainText('2 movement remaining.');
      await hex(b, '-1,1', true).click();
      await expect(b.locator('.evocation-controls')).toContainText('1 movement remaining.');
      await expect(hex(b, '-1,1').locator('.evocation-marker')).toHaveText('☠2');
      await expect(b.getByRole('button', { name: /^Cadaver attack Moon Browser\b/ })).toHaveCount(0);
      await expect(b.getByRole('button', { name: /^Cadaver attack Cadaver \(Moon Browser\)/ })).toHaveCount(0);
      const availableBefore = await player(b, moon.name).locator('[title="Available cubes"]').innerText();
      const attackModel = b.getByRole('button', { name: /^Cadaver attack Cadaver \(Ember Browser\)/ });
      await expect(attackModel.locator('small')).toHaveText('2 damage');
      await attackModel.click();
      await expectPhase(pages, 'Cleanup');
      await expectNoActingMage(pages);
      for (const page of pages) {
        await expect(page.getByRole('heading', { name: '❖ The lodge settles', exact: true })).toBeVisible();
        await expect(page.locator(`[data-evocation-id="${emberId}"]`)).toHaveCount(0);
        await expect(page.locator(`[data-evocation-id="${moonId}"]`)).toHaveCount(1);
        await expect(page.locator('.evocation-controls')).toHaveCount(0);
        await expect(hex(page, '-1,1').locator('.evocation-marker')).toHaveText('☠1');
        await expect(page.locator('.log').getByText(/Cadaver is destroyed; its damage cubes return to their owners/)).toBeVisible();
        await expect(player(page, moon.name).locator('.cube-pool')).toContainText('On evocations: 0');
      }
      // Cleanup may also return room cubes, but no damage cubes may remain on the destroyed model.
      const availableAfter = await player(b, moon.name).locator('[title="Available cubes"]').innerText();
      expect(Number(availableAfter.replace('◆ ', ''))).toBeGreaterThanOrEqual(Number(availableBefore.replace('◆ ', '')));
      await capture(a, testInfo, 'cleanup-desktop');
    });

    await test.step('Refresh two tokens next round, preserve the surviving model, and fit mobile screens', async () => {
      await a.getByRole('button', { name: 'Begin round 2', exact: false }).click();
      await expectPhase(pages, 'Black Rose');
      await expectNoActingMage(pages);
      for (const [i, page] of pages.entries()) {
        await expect(page.locator('.event-panel')).toContainText('Round 2');
        for (const mage of [ember, moon]) await expectTokens(page, mage.name, 2);
        const survivor = page.locator(`.evocation-card[data-evocation-id="${moonId}"]`);
        await expect(survivor).toHaveCount(1);
        await expectEvocationLocation(page, moonId, moon, '-1,1');
        await expect(survivor.locator('.model-stats > span')).toHaveText(['↝ 2', '⚔ 2', '♥ 2/2']);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(hex(page, '-1,1').locator('.evocation-marker')).toHaveText('☠1');
        await survivor.scrollIntoViewIfNeeded();
        await expect(survivor).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          { message: `${i === 0 ? ember.name : moon.name}: mobile layout must not overflow horizontally` }).toBe(true);
        await capture(page, testInfo, `round-two-mobile-${i + 1}`);
        await expect(page.getByRole('alert')).toHaveCount(0);
        expect(pageErrors[i], `Uncaught errors in browser ${i + 1}`).toEqual([]);
        expect(dialogs[i], `Unexpected dialogs in browser ${i + 1}`).toEqual([]);
      }
    });
  } finally {
    await Promise.all(pages.map(page => page.close()));
  }
});

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function withMages(browser: Browser, info: TestInfo, prefix: string, run: (mages: Mage[]) => Promise<void>) {
  const pages = await Promise.all([1, 2].map(() => browser.newPage({ reducedMotion: 'no-preference' })));
  const mages: Mage[] = pages.map((page, i) => ({ page, id: `p${i + 1}`, name: `${prefix} ${i ? 'Moon' : 'Ember'}`, coordinates: i ? '-3,2' : '3,-2' }));
  const errors: string[] = [], dialogs: string[] = [];
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  }
  try {
    await Promise.all(pages.map(page => page.goto('/')));
    const room = `${prefix}-${info.workerIndex}-${info.retry}-${Date.now()}`;
    for (const [index, mage] of mages.entries()) {
      await mage.page.getByLabel('Mage name').fill(mage.name);
      await mage.page.getByLabel('Room name').fill(room);
      await mage.page.getByRole('button', { name: index ? 'Join room' : 'Create room', exact: true }).click();
      await mage.page.getByRole('button', { name: 'Mark ready', exact: true }).click();
    }
    await expectPhase(pages, 'Black Rose');
    await expectAttributes(pages);
    await run(mages);
    expect(errors, 'Uncaught browser errors').toEqual([]);
    expect(dialogs, 'Unexpected browser dialogs').toEqual([]);
    for (const page of pages) await expect(page.getByRole('alert')).toHaveCount(0);
  } catch (error) {
    for (const [index, page] of pages.entries()) await capture(page, info, `failure-mage-${index + 1}`).catch(() => {});
    throw error;
  } finally {
    await Promise.all(pages.map(page => page.close()));
  }
}

test('four real browsers wait for every joined mage, auto-start, show named rooms and rotate through all four colors', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const pages = await Promise.all(Array.from({ length: 4 }, () => browser.newPage({ reducedMotion: 'no-preference' })));
  const starts = ['3,-2', '-3,2', '-1,-2', '1,2'];
  const mages: Mage[] = pages.map((page, i) => ({ page, id: `p${i + 1}`, name: ['Rose Warden', 'Blue Seer', 'Amber Sage', 'Green Mancer'][i], coordinates: starts[i] }));
  const errors: string[] = [];
  pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
  try {
    await Promise.all(pages.map(page => page.goto('/')));
    const lobby = `four-mages-${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
    const [host, blue, amber, green] = mages;
    for (const [index, mage] of mages.entries()) {
      await mage.page.getByLabel('Mage name').fill(mage.name);
      await mage.page.getByLabel('Room name').fill(lobby);
      if (index) {
        await expect(mage.page.locator('.entry-card > p')).toContainText('2–4 mage online battle');
        await expect(mage.page.locator('.room-list button').filter({ hasText: lobby })).toContainText(`${index}/4 · waiting`);
      }
      await mage.page.getByRole('button', { name: index ? 'Join room' : 'Create room', exact: true }).click();
      await expect(mage.page.locator('.lobby-count')).toHaveText(`${index + 1} / 4 mages · 0 ready`);
      if (!index) {
        await mage.page.getByRole('button', { name: 'Mark ready', exact: true }).click();
        await expect(mage.page.locator('.lobby-count')).toHaveText('1 / 4 mages · 1 ready');
        await expect(mage.page.locator('.lobby-readiness')).toContainText('Waiting for at least 2 mages');
        await expect(mage.page.locator('.event-panel')).toHaveCount(0);
        await expect(mage.page.locator('.player')).toHaveCount(1);
        await mage.page.getByRole('button', { name: 'Cancel ready', exact: true }).click();
        await expect(mage.page.locator('.lobby-count')).toHaveText('1 / 4 mages · 0 ready');
      }
    }
    for (const page of pages) {
      await expect(page.locator('.lobby-seats .seat')).toHaveCount(4);
      await expect(page.locator('.lobby-count')).toHaveText('4 / 4 mages · 0 ready');
      await expect(page.getByRole('button', { name: 'Start game', exact: true })).toHaveCount(0);
      for (const [index, mage] of mages.entries()) {
        const seat = page.locator(`.seat[data-player-id="${mage.id}"]`);
        await expect(seat).toContainText(mage.name);
        await expect(seat).toHaveCSS('border-left-color', mageColors[index]);
      }
      expect(new Set(await page.locator('.seat .mage-icon').allTextContents()).size).toBe(4);
    }
    for (const mage of [blue, amber, green]) await mage.page.getByRole('button', { name: 'Mark ready', exact: true }).click();
    for (const page of pages) {
      await expect(page.locator('.lobby-readiness')).toContainText('3 of 4 joined mages ready');
      await expect(page.locator('.event-panel')).toHaveCount(0);
    }
    await amber.page.getByRole('button', { name: 'Cancel ready', exact: true }).click();
    await host.page.getByRole('button', { name: 'Mark ready', exact: true }).click();
    for (const page of pages) {
      await expect(page.locator('.lobby-count')).toHaveText('4 / 4 mages · 3 ready');
      await expect(page.getByRole('heading', { name: 'Gather the mages', exact: true })).toBeVisible();
    }
    await amber.page.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await expectPhase(pages, 'Black Rose');
    await expectAttributes(pages);
    const names = await pages[0].locator('.room-name').allTextContents();
    expect(new Set(names.map(name => name.trim())).size).toBe(23);
    for (const page of pages) {
      await expect(page.locator('.room-name')).toHaveCount(23);
      await expect(page.locator('text.coordinate')).toHaveCount(0);
      expect(await page.locator('.room-name').allTextContents()).toEqual(names);
      for (const tile of await page.locator('g.hex').all()) {
        const name = (await tile.locator('.room-name').textContent())!.trim();
        expect(name).toMatch(/^[A-Za-z ]+$/);
        await expect(tile).toHaveAttribute('aria-label', new RegExp(`^${name},`));
        await expect(tile.locator(':scope > title')).toContainText(name);
      }
      await expect(hex(page, '0,0').locator('.room-name')).toHaveText('Black Rose Chamber');
      await expect(page.locator('footer')).toContainText('2–4 mages');
      await expect(page.locator('.reference')).toContainText('Dense ranks');
      await expect(page.locator('.reference')).toContainText('1 VP, minimum 1');
      await expect(page.locator('.reference')).toContainText('Other rooms: 5 cubes · 3 / 1 VP');
    }
    await receiveQuests(mages, testInfo);
    await studyAndPrepare(pages);
    const paths = [
      [['2,-2', '1,-1'], ['0,0']],
      [['-2,2', '-2,1'], ['-1,1', '0,0']],
      [['0,-2', '1,-2'], ['1,-1', '0,0']],
      [['1,1'], ['0,1', '0,0']],
    ];
    for (const [index, mage] of mages.entries()) {
      expect((await actionOwner(mages))?.id).toBe(mage.id);
      await expectActing(pages, mage);
      await expectActions(mage, 2);
      await beginPhysical(mage, pages, 'EXPLORE', 1);
      await move(mage, pages, paths[index][0]);
      if (index !== 2) {
        if (index === 3) {
          const options = mage.page.getByLabel('Emerald effect target').locator('option');
          const text = await options.allTextContents();
          expect(text.length).toBeGreaterThan(1);
          expect(text.slice(1).every(option => names.some(name => option.startsWith(name.trim())))).toBe(true);
        }
        await roomButton(mage.page).click();
        await expect(mage.page.locator('.physical-effects')).toHaveCount(0);
      } else await skipEffects(mage, pages);
      await beginPhysical(mage, pages, 'EXPLORE', 0);
      await move(mage, pages, paths[index][1]);
      await skipEffects(mage, pages);
      for (const page of pages) await expectTokens(page, mage.name, 0);
    }
    expect((await actionOwner(mages))?.id).toBe(host.id);
    await expectActing(pages, host);
    for (const page of pages) {
      await expect(hex(page, '0,0').locator('[data-mage-id]')).toHaveCount(4);
      await expect(page.locator('.evocation-card')).toHaveCount(2);
      await expect(hex(page, '1,1').locator('.cube-owner')).not.toHaveCount(0);
      for (const mage of [host, blue]) {
        const own = page.locator('.evocation-card').filter({ hasText: `${mage.name} · Undead` });
        await expect(own.locator(':scope > small')).toHaveText(`${mage.name} · Undead · ${await roomName(page, paths[mages.indexOf(mage)][0][1])}`);
      }
      await expect(hex(page, '1,1').locator('.cube-owner circle').last()).toHaveCSS('fill', mageColors[3]);
      await hex(page, '0,0').click();
      await expect(page.locator('.room-detail > strong')).toHaveText('Black Rose Chamber');
      // Geometry and contrast are read from the rendered SVG, never injected state.
      const readability = await page.locator('g.hex:not(.start-room)').evaluateAll(tiles => tiles.map(tile => {
        const count = tile.querySelector<SVGTextElement>('.cube-count')!;
        const badge = tile.querySelector<SVGRectElement>('.capacity-background')!;
        const name = tile.querySelector<SVGTextElement>('.room-name')!;
        const box = count.getBBox(), bounds = badge.getBBox(), label = name.getBBox();
        return {
          pixels: parseFloat(getComputedStyle(count).fontSize) * count.getScreenCTM()!.a,
          inside: box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width && box.y >= bounds.y && box.y + box.height <= bounds.y + bounds.height,
          separated: label.y + label.height < bounds.y,
          fill: getComputedStyle(count).fill, background: getComputedStyle(badge).fill,
        };
      }));
      for (const badge of readability) {
        expect(badge.pixels).toBeGreaterThanOrEqual(16);
        expect(badge.inside).toBe(true);
        expect(badge.separated).toBe(true);
        expect(badge.fill).toBe('rgb(23, 17, 27)');
        expect(badge.background).toBe('rgb(255, 245, 223)');
      }
      const models = await hex(page, '0,0').locator('[data-mage-id]').evaluateAll(tokens => tokens.map(token => token.getBoundingClientRect().toJSON()));
      for (let i = 1; i < models.length; i++) expect(models[i].x).toBeGreaterThan(models[i - 1].x);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.locator('.board-viewport')).toHaveAttribute('tabindex', '0');
      await expect(page.locator('.board')).toHaveCSS('min-width', '720px');
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await capture(host.page, testInfo, 'four-mages-named-board-mobile');
    expect(errors).toEqual([]);
  } catch (error) {
    await capture(pages[0], testInfo, 'four-mages-failure').catch(() => {});
    throw error;
  } finally {
    await Promise.all(pages.map(page => page.close()));
  }
});

async function receiveQuests(mages: Mage[], info: TestInfo) {
  const pages = mages.map(mage => mage.page);
  await pages[0].getByRole('button', { name: /^Receive quests & begin Study/ }).click();
  // A resolved Black Rose is observable as the quest gate, not a second Continue click.
  await expect.poll(async () => {
    const phases = await Promise.all(pages.map(page => page.locator('.phase-track .current span').textContent()));
    return phases.every(phase => phase === 'Study') ||
      phases.every(phase => phase === 'Black Rose') &&
      (await Promise.all(pages.map(page => page.locator('.event-panel fieldset').count()))).every(count => count === 1);
  }).toBe(true);
  let discarded = 0;
  if (await pages[0].locator('.phase-track .current span').textContent() === 'Black Rose') {
    for (const mage of mages) {
      if (await mage.page.locator('.phase-track .current span').textContent() === 'Study') break;
      const excess = await mage.page.locator('.quest-panel .quest-entry').count() - 2;
      if (excess <= 0) {
        await expect(mage.page.locator('.event-panel')).toContainText('Your quests meet the limit of 2. Waiting for the other mages');
        continue;
      }
      const panel = mage.page.locator('.quest-limit-panel');
      const choices = panel.locator('.quest-choices button');
      const confirm = panel.getByRole('button', { name: /^Discard excess quests/ });
      await expect(panel.getByRole('heading', { name: 'Keep up to 2 quests', exact: true })).toBeVisible();
      await expect(choices).toHaveCount(excess + 2);
      await expect(confirm).toHaveText(`Discard excess quests (0/${excess})`);
      await expect(confirm).toBeDisabled();
      for (const page of pages) {
        await expect(page.locator('.phase-track .current span')).toHaveText('Black Rose');
        await expect(page.getByRole('heading', { name: 'Six schools. Infinite possibilities.', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Receive quests & begin Study/ })).toHaveCount(0);
      }
      for (let index = 0; index < excess; index++) await choices.nth(index).click();
      await choices.nth(excess).click();
      await expect(panel.locator('.quest-choices button[aria-pressed="true"]')).toHaveCount(excess);
      await expect(confirm).toHaveText(`Discard excess quests (${excess}/${excess})`);
      await choices.first().click();
      await expect(confirm).toBeDisabled();
      await choices.first().click();
      const round = (await mage.page.locator('.event-panel > .eyebrow').textContent())!.match(/Round (\d+)/)![1];
      await capture(mage.page, info, `quest-limit-${mage.id}-round-${round}`);
      const vp = await player(mage.page, mage.name).locator('.player-heading > b').textContent();
      const progress = await mage.page.locator('.quest-panel > .hint').first().textContent();
      await confirm.click();
      await expect(panel).toHaveCount(0);
      await expect(mage.page.locator('.quest-panel .quest-entry')).toHaveCount(2);
      await expect(player(mage.page, mage.name).locator('.player-heading > b')).toHaveText(vp!);
      await expect(mage.page.locator('.quest-panel > .hint').first()).toHaveText(progress!);
      discarded += excess;
    }
  }
  await expectPhase(pages, 'Study');
  return discarded;
}

async function finishFreeEvocations(mages: Mage[], moveMoon = false) {
  const pages = mages.map(mage => mage.page);
  await expectPhase(pages, 'Evocation');
  const used = new Set<string>();
  for (let guard = 0; guard < 8; guard++) {
    if (await pages[0].locator('.phase-track .current span').textContent() === 'Cleanup') {
      await expectPhase(pages, 'Cleanup');
      await expectNoActingMage(pages);
      return;
    }
    const name = await pages[0].locator('.turn-banner strong').textContent();
    const mage = mages.find(mage => mage.name === name)!;
    const card = mage.page.locator('.evocation-card[data-owned="true"]').filter({ has: mage.page.locator('button:not(:disabled)') }).first();
    await expect(card).toBeVisible();
    const id = (await card.getAttribute('data-evocation-id'))!;
    expect(used.has(id), 'Free activations must never repeat a model').toBe(false);
    used.add(id);
    await card.getByRole('button', { name: /^Activate Cadaver/ }).click();
    await expectActing(pages, mage, 'Controlling an evocation');
    if (moveMoon && mage.id === 'p2') {
      for (const coordinates of ['-1,0', '0,-1']) await hex(mage.page, coordinates, true).click();
      await expect(mage.page.locator('.evocation-controls')).toContainText('0 movement remaining.');
    }
    await mage.page.getByRole('button', { name: 'Finish evocation', exact: true }).click();
    await expect(mage.page.locator('.evocation-controls')).toHaveCount(0);
  }
  throw new Error('Free evocations did not exhaust into Cleanup');
}

async function attackMage(attacker: Mage, victim: Mage, pages: Page[]) {
  const health = player(attacker.page, victim.name).locator('.player-stats > span').first();
  const before = Number((await health.textContent())!.match(/♥ (\d+)\/10/)![1]);
  await attacker.page.getByRole('button', { name: /^Inflict 2 damage to a model at distance 0/ }).click();
  const targets = attacker.page.locator('.attack-targets');
  await expect(targets).toBeVisible();
  // Friendly mages/models and adjacent enemy Cadavers must be absent, not merely disabled.
  await expect(targets.getByRole('button')).toHaveText([`Inflict 2 damage on ${victim.name}`]);
  await expect(targets.getByRole('button')).toBeEnabled();
  await expect(targets.getByRole('button', { name: /Cadaver/ })).toHaveCount(0);
  await targets.getByRole('button', { name: `Inflict 2 damage on ${victim.name}`, exact: true }).click();
  for (const page of pages) {
    await expect(player(page, victim.name).locator('.player-stats > span').first()).toHaveText(`♥ ${before - 2}/10`);
    await expect(player(page, victim.name).locator('.damage-ledger')).toContainText(`${attacker.name}: 2`);
    await expect(player(page, attacker.name).locator('.cube-pool')).toContainText('On mages: 2');
    await expectTokens(page, attacker.name, 0);
  }
}

test('pending Explore and Attack menus resolve either order, skip safely, and attack only same-hex enemies', async ({ browser }, testInfo) => {
  await withMages(browser, testInfo, 'Menus', async mages => {
    const [ember, moon] = mages, [a, b] = mages.map(mage => mage.page), pages = [a, b];
    await receiveQuests(mages, testInfo);
    await studyAndPrepare(pages);

    await test.step('Movement first stays pending after the last step; room first can be skipped mid-move', async () => {
      await expect(attackButton(a)).toBeDisabled();
      await beginPhysical(ember, pages, 'EXPLORE', 1);
      await expect(roomButton(a)).toBeDisabled();
      await move(ember, pages, ['2,-2', '1,-1']);
      await expectPhysicalLock(ember, pages, 'EXPLORE');
      await expect(a.locator('.evocation-card')).toHaveCount(0);
      await roomButton(a).click();
      await expect(a.locator('.physical-effects')).toHaveCount(0);
      await expect(a.locator('.evocation-card[data-owned="true"]')).toHaveCount(1);
      await expect(a.locator('.evocation-card[data-owned="true"] button')).toBeEnabled();

      await beginPhysical(ember, pages, 'EXPLORE', 0);
      await roomButton(a).click();
      await expect(a.locator('.evocation-card[data-owned="true"]')).toHaveCount(2);
      await expectPhysicalLock(ember, pages, 'EXPLORE');
      await expect(roomButton(a)).toBeDisabled();
      await expect(movementButton(a)).toBeEnabled();
      await movementButton(a).click();
      await hex(a, '1,0', true).click();
      ember.coordinates = '1,0';
      await expect(a.locator('.movement-progress strong')).toHaveText('1 movement remaining');
      await capture(a, testInfo, 'explore-room-first-mid-movement');
      await skipEffects(ember, pages);
      await expect(a.locator('g.hex.reachable')).toHaveCount(0);
      await expectActing(pages, moon);

      await beginPhysical(moon, pages, 'EXPLORE', 1);
      await expect(roomButton(b)).toBeDisabled();
      await skipEffects(moon, pages);
      await expect(attackButton(b)).toBeDisabled();
      await beginPhysical(moon, pages, 'EXPLORE', 0);
      await move(moon, pages, ['-2,2', '-2,1']);
      await expectPhysicalLock(moon, pages, 'EXPLORE');
      await roomButton(b).click();
      await expect(b.locator('.physical-effects')).toHaveCount(0);
      await expectActing(pages, ember);
      await drainSpells(mages, 8);
      await finishFreeEvocations(mages, true);
    });

    await test.step('Meet in round two, keeping enemy summons adjacent rather than in the attack list', async () => {
      await a.getByRole('button', { name: /^Begin round 2/ }).click();
      await expectPhase(pages, 'Black Rose');
      await receiveQuests(mages, testInfo);
      await studyAndPrepare(pages);
      await beginPhysical(ember, pages, 'EXPLORE', 1);
      await move(ember, pages, ['0,0']);
      await expectPhysicalLock(ember, pages, 'EXPLORE');
      await roomButton(a).click();
      await expect(a.locator('.physical-effects')).toHaveCount(0);
      await expect(a.locator('.powerful-panel .spell')).toHaveCount(1);
      await endTurn(ember, mages);

      await beginPhysical(moon, pages, 'EXPLORE', 1);
      await roomButton(b).click();
      await expectPhysicalLock(moon, pages, 'EXPLORE');
      await move(moon, pages, ['-1,1', '0,0']);
      await expect(b.locator('.physical-effects')).toHaveCount(0);
      await expectMageAt(pages, ember, '0,0');
      await expectMageAt(pages, moon, '0,0');
      await expect(hex(b, '1,-1').locator('.evocation-marker')).toHaveText('☠2');
      await expect(hex(a, '0,-1').locator('.evocation-marker')).toHaveText('☠1');
    });

    await test.step('Attack room-first locks powerful spells, then the same-hex mage takes exactly two damage', async () => {
      await beginPhysical(moon, pages, 'ATTACK', 0);
      await roomButton(b).click();
      await expect(b.locator('.powerful-panel .spell')).toHaveCount(1);
      await expectPhysicalLock(moon, pages, 'ATTACK');
      await expect(roomButton(b)).toBeDisabled();
      await capture(b, testInfo, 'attack-room-first-powerful-locked');
      await attackMage(moon, ember, pages);
      await expect(b.locator('.physical-effects')).toHaveCount(0);
      await expectActing(pages, ember);
    });

    await test.step('Attack primary-first leaves the room pending, then both effects auto-end without another token', async () => {
      await beginPhysical(ember, pages, 'ATTACK', 0);
      await attackMage(ember, moon, pages);
      await expectPhysicalLock(ember, pages, 'ATTACK');
      await expect(a.getByRole('button', { name: /^Inflict 2 damage to a model at distance 0/ })).toBeDisabled();
      await expect(a.locator('.attack-targets')).toHaveCount(0);
      await expect(roomButton(a)).toBeEnabled();
      await capture(a, testInfo, 'attack-primary-first-room-pending');
      for (const page of pages) {
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.locator('.turn-banner')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          { message: 'The active turn banner, public stats and new physical menus must fit on mobile' }).toBe(true);
      }
      await expectPhysicalLock(ember, pages, 'ATTACK');
      await capture(a, testInfo, 'attack-pending-active-turn-mobile');
      await roomButton(a).click();
      await expect(a.locator('.physical-effects')).toHaveCount(0);
      await expect(a.locator('.powerful-panel .spell')).toHaveCount(2);
      await expectAttributes(pages);
    });
  });
});

test('two Explores hand off with spells uncast; spell highlights and powerful dummy targets use straight hex lines', async ({ browser }, testInfo) => {
  await withMages(browser, testInfo, 'Range', async mages => {
    const [ember, moon] = mages, pages = mages.map(mage => mage.page), a = ember.page;
    await receiveQuests(mages, testInfo);
    await studyAndPrepare(pages);
    // Reach the center and obtain a real powerful spell (every power has range >= 2).
    await beginPhysical(ember, pages, 'EXPLORE', 1);
    await move(ember, pages, ['2,-2', '1,-1']);
    await skipEffects(ember, pages);
    await beginPhysical(ember, pages, 'EXPLORE', 0);
    await move(ember, pages, ['0,0']);
    await expectActions(ember, 0);
    await expectActing(pages, ember);
    await expectPhysicalLock(ember, pages, 'EXPLORE');
    await expect(a.locator('.prepared .spell')).toHaveCount(4);
    await expect(a.locator('.prepared .spell.used')).toHaveCount(0);
    await roomButton(a).click();
    await expect(a.locator('.physical-effects')).toHaveCount(0);
    const power = a.locator('.powerful-panel .spell').first();
    await expectActing(pages, moon);
    await expect(a.locator('.phase-panel .badge')).toHaveText('Waiting');
    await expect(a.locator('.prepared .spell')).toHaveCount(4);
    await expect(a.locator('.prepared .spell.used')).toHaveCount(0);
    await expect(a.locator('.prepared .spell:not(:disabled)')).toHaveCount(0);
    await expect(power).toBeDisabled();
    for (const page of pages) await expectTokens(page, ember.name, 0);
    // Yield the opponent's real turn before testing the center gift. No free
    // spell is legal immediately after the two completed Explores.
    await beginPhysical(moon, pages, 'EXPLORE', 1);
    await move(moon, pages, ['-2,2']);
    await skipEffects(moon, pages);
    await endTurn(moon, mages);
    await expectActions(ember, 2);
    await expect(power).toBeEnabled();
    await expect(power).toContainText('1 action to cast');
    const model = (await power.locator('.eyebrow').textContent())!.endsWith(' · Model');
    await power.click();
    if (model) await a.getByRole('button', { name: 'Target dummy · no damage', exact: true }).click();
    await expect(a.locator('g.hex.reachable')).toHaveCount(13);
    await expect(a.locator('g.hex.start-room.reachable')).toHaveCount(0);
    for (const coordinates of ['1,-2', '-1,-1', '2,-1', '-2,1', '1,1', '-1,2']) {
      await expect(hex(a, coordinates)).not.toHaveClass(/reachable/);
      await hex(a, coordinates).click();
      await expect(a.locator('.room-detail').getByRole('button', { name: /^Cast .* here/ })).toBeDisabled();
    }
    for (const coordinates of ['0,0', '2,0', '0,2', '-2,2', '-2,0', '0,-2', '2,-2']) {
      await expect(hex(a, coordinates)).toHaveClass(/reachable/);
      await hex(a, coordinates).click();
      await expect(a.locator('.room-detail').getByRole('button', { name: /^Cast .* here/ })).toBeEnabled();
    }
    await expect(pages[1].locator('g.hex.reachable')).toHaveCount(0);
    await a.locator('.room-detail').getByRole('button', { name: /^Cast .* here/ }).click();
    for (const page of pages) {
      await expect(page.locator('.log > div').filter({ hasText: /is removed from the game after use/ })).toBeVisible();
      await expectTokens(page, ember.name, 0);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await expect(a.locator('.powerful-panel .spell')).toHaveCount(0);
    await expectActions(ember, 1);
    await expectActing(pages, ember);
  });
});

test('discard exit, flexible and numbered spells each use one turn action without spending physical tokens', async ({ browser }, testInfo) => {
  await withMages(browser, testInfo, 'Action costs', async mages => {
    const [ember, moon] = mages, pages = mages.map(mage => mage.page);
    await receiveQuests(mages, testInfo);
    await studyAndPrepare(pages);
    for (const [index, mage] of mages.entries()) {
      await expectActing(pages, mage);
      await expectActions(mage, 2);
      await expect(mage.page.locator('.actions-panel .notice')).toContainText('1 turn action and no physical token');
      await mage.page.getByLabel('Card to discard for exit').selectOption({ index: 4 });
      mage.coordinates = index ? '-2,2' : '2,-2';
      await hex(mage.page, mage.coordinates, true).click();
      await expectMageAt(pages, mage, mage.coordinates);
      await expectActions(mage, 1);
      await expect(mage.page.locator('.prepared .spell.used .eyebrow')).toHaveText(/^Spell 3 ·/);
      for (const page of pages) await expectTokens(page, mage.name, 2);
      await endTurn(mage, mages);
    }

    // Flexible first leaves the numbered quota intact, but spends half the turn.
    await castPrepared(ember, pages, ember.page.locator('.prepared .spell').filter({ hasText: '✧ Flexible' }));
    await expectActions(ember, 1);
    await expect(ember.page.locator('.prepared .spell:enabled').filter({ hasText: /^Spell 1 ·/ })).toHaveCount(1);
    await castPrepared(ember, pages, ember.page.locator('.prepared .spell').filter({ hasText: /^Spell 1 ·/ }));
    expect((await actionOwner(mages))?.id).toBe(moon.id);
    await expectActing(pages, moon);
    await expectActions(moon, 2);
    await expect(ember.page.locator('.prepared .spell:enabled')).toHaveCount(0);
    await expect(ember.page.locator('.prepared .spell.used')).toHaveCount(3);

    // Numbered first locks slot 2, not the flexible card, for the remaining action.
    await castPrepared(moon, pages, moon.page.locator('.prepared .spell').filter({ hasText: /^Spell 1 ·/ }));
    await expectActions(moon, 1);
    await expect(moon.page.locator('.prepared .spell:enabled').filter({ hasText: /Spell [123] ·/ })).toHaveCount(0);
    await expect(moon.page.locator('.prepared .spell:enabled').filter({ hasText: '✧ Flexible' })).toHaveCount(1);
    await castPrepared(moon, pages, moon.page.locator('.prepared .spell').filter({ hasText: '✧ Flexible' }));
    expect((await actionOwner(mages))?.id).toBe(ember.id);
    await expectActing(pages, ember);
    await expectActions(ember, 2);
    await expect(moon.page.locator('.prepared .spell:enabled')).toHaveCount(0);
    await expect(moon.page.locator('.prepared .spell.used')).toHaveCount(3);
    for (const page of pages) {
      for (const mage of mages) await expectTokens(page, mage.name, 2);
      await expect(page.locator('.log > div').filter({ hasText: /casts .*for 1 action \(no physical token\)/ })).toHaveCount(4);
    }
  });
});

// Observe real rendered disabled-attribute transitions; do not intercept traffic or alter game state.
async function observePendingFieldsets(page: Page) {
  return page.evaluateHandle(() => {
    const transitions: string[] = [];
    new MutationObserver(records => {
      for (const record of records) {
        if (record.target instanceof HTMLFieldSetElement && record.oldValue === null) {
          transitions.push(record.target.textContent ?? '');
        }
      }
    }).observe(document.querySelector('main')!, { subtree: true, attributes: true, attributeFilter: ['disabled'], attributeOldValue: true });
    return transitions;
  });
}

test('three real rounds retain draws into the hand limit and enforce reachable Amber quest overflow', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  await withMages(browser, testInfo, 'Limits', async mages => {
    const [ember, moon] = mages, [a, b] = mages.map(mage => mage.page), pages = [a, b];
    const fieldsets = await Promise.all(pages.map(observePendingFieldsets));
    let questDiscards = await receiveQuests(mages, testInfo);
    let spentAmberSpecialSkips = 0;
    await studyAndPrepare(pages);

    async function amberQuests(tokens: number) {
      await beginPhysical(moon, pages, 'ATTACK', tokens);
      await expect(b.getByRole('button', { name: /^Inflict 2 damage to a model at distance 0/ })).toBeDisabled();
      await expect(b.locator('.physical-effects')).toContainText('No enemy model in this room.');
      // Random prepared spells/events may rebuild Amber in round one. Its doubled
      // special is then once per Action phase: the next token must skip, not hang.
      if (await roomButton(b).isDisabled()) {
        await expect(b.locator('.physical-room-effect')).toContainText('Used this Action phase');
        spentAmberSpecialSkips++;
        await skipEffects(moon, pages);
        return;
      }
      const before = await b.locator('.quest-entry').count();
      await roomButton(b).click();
      await expect.poll(() => b.locator('.quest-entry').count()).toBeGreaterThan(before);
      await expectPhysicalLock(moon, pages, 'ATTACK');
      await skipEffects(moon, pages);
    }

    await test.step('Round one retains two Violet draws and gathers real additional Amber quests', async () => {
      // The third numbered spell is a school card; the first two personal spells will seed Azure's discard.
      await a.getByLabel('Card to discard for exit').selectOption({ index: 4 });
      await hex(a, '2,-2', true).click();
      ember.coordinates = '2,-2';
      await expectMageAt(pages, ember, ember.coordinates);
      await beginPhysical(ember, pages, 'EXPLORE', 1);
      await move(ember, pages, ['1,-1', '0,-1']);
      await roomButton(a).click();
      await expect(a.locator('.physical-effects')).toHaveCount(0);
      await expectActing(pages, moon);

      await beginPhysical(moon, pages, 'EXPLORE', 1);
      await move(moon, pages, ['-2,2']);
      await roomButton(b).click();
      await expect(b.locator('.physical-effects')).toHaveCount(0);
      await amberQuests(0);
      await expectActing(pages, ember);

      await beginPhysical(ember, pages, 'EXPLORE', 0);
      await roomButton(a).click();
      await move(ember, pages, []);
      await expect(a.locator('.reference')).toContainText('Hand 2/7');
      await drainSpells(mages, 7, 'Cleanup');
      await expectPhase(pages, 'Cleanup');
    });

    await test.step('Round two holds school cards, draws in Violet and retrieves in Azure', async () => {
      await a.getByRole('button', { name: /^Begin round 2/ }).click();
      await expectPhase(pages, 'Black Rose');
      questDiscards += await receiveQuests(mages, testInfo);
      await studyAndPrepare(pages);
      await expect(a.locator('.reference')).toContainText('Hand 2/7');
      await beginPhysical(ember, pages, 'EXPLORE', 1);
      await roomButton(a).click();
      await move(ember, pages, ['0,0', '0,1']);
      await expect(a.locator('.physical-effects')).toHaveCount(0);
      await beginPhysical(ember, pages, 'EXPLORE', 0);
      await roomButton(a).click();
      await move(ember, pages, []);
      await expect(a.locator('.reference')).toContainText(/Hand [45]\/7/);
      await expectActing(pages, moon);
      await amberQuests(1);
      await amberQuests(0);
      await drainSpells(mages, 8, 'Cleanup');
      await expectPhase(pages, 'Cleanup');
    });

    await test.step('Round three gates Preparation, selects exactly the excess, and sends school cards to personal discard', async () => {
      await a.getByRole('button', { name: /^Begin round 3/ }).click();
      await expectPhase(pages, 'Black Rose');
      questDiscards += await receiveQuests(mages, testInfo);
      await studyCards(pages);
      const panel = a.locator('.hand-limit-panel'), cards = panel.locator('.spell');
      await expect(panel.getByRole('heading', { name: 'Reduce your hand to 7 cards', exact: true })).toBeVisible();
      await expect(a.getByRole('button', { name: 'Prepare spells', exact: true })).toHaveCount(0);
      const count = await cards.count(), excess = count - 7;
      expect(excess).toBeGreaterThan(0);
      expect(excess, 'At most two old school cards are carried in this route').toBeLessThanOrEqual(2);
      const confirm = panel.getByRole('button', { name: /^Discard excess cards/ });
      await expect(confirm).toHaveText(`Discard excess cards (0/${excess})`);
      await expect(confirm).toBeDisabled();
      await expect(panel.locator('.spell:disabled')).toHaveCount(0);
      const names = await cards.locator('strong').allTextContents();
      const discardBefore = Number((await a.locator('.reference > .hint').textContent())!.match(/Personal discard (\d+)/)![1]);
      for (let index = 0; index < excess; index++) await cards.nth(index).click();
      await cards.nth(excess).click();
      await expect(panel.locator('.spell.chosen')).toHaveCount(excess);
      await expect(confirm).toHaveText(`Discard excess cards (${excess}/${excess})`);
      await cards.first().click();
      await expect(confirm).toBeDisabled();
      await cards.first().click();
      await capture(a, testInfo, 'round-three-hand-overflow-selected');
      // The other mage may prepare, but Action must wait for this mage's limit and slots.
      for (let index = 0; index < 4; index++) await b.locator('.phase-panel .spell').nth(index).click();
      await b.getByRole('button', { name: 'Prepare spells', exact: true }).click();
      for (const page of pages) await expect(page.locator('.phase-track .current span')).toHaveText('Preparation');
      await confirm.click();
      await expect(panel).toHaveCount(0);
      await expect(a.getByRole('heading', { name: 'Three ordered spells. One wild card.', exact: true })).toBeVisible();
      await expect(a.locator('.phase-panel .spell')).toHaveCount(7);
      await expect(a.locator('.phase-panel .spell strong')).toHaveText(names.slice(excess));
      await expect(a.locator('.reference > .hint')).toContainText(`Personal discard ${discardBefore + excess}`);
      await expect(a.locator('.reference > .hint')).toContainText('Hand 7/7');
      await capture(a, testInfo, 'round-three-hand-limit-resolved');
      await prepareCards([a]);
      await expectPhase(pages, 'Action');
      await expectAttributes(pages);
      for (const handle of fieldsets) {
        expect((await handle.jsonValue()).length, 'Real requests must disable their containing fieldset while pending').toBeGreaterThan(0);
        await handle.dispose();
      }
      const coverage = { roundsReached: 3, handDiscards: excess, schoolCardsToPersonalDiscard: excess, questDiscards, spentAmberSpecialSkips };
      await testInfo.attach('limits-coverage', { body: JSON.stringify(coverage, null, 2), contentType: 'application/json' });
      testInfo.annotations.push({ type: 'coverage', description: JSON.stringify(coverage) });
      if (!questDiscards) testInfo.annotations.push({ type: 'gap', description: 'Amber quests completed before Black Rose; no random quest overflow occurred. No state was injected.' });
    });
  });
});